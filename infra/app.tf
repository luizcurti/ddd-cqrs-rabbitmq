# The docker-compose stack on ECS Fargate: the API behind an ALB (in place of nginx), the
# order read-model consumer and the outbox relay, and RabbitMQ, which the others reach at
# rabbitmq.<name>.internal through a Cloud Map private DNS name. The API and both workers run
# the same image (only the command differs, as in docker-compose). Jaeger, Prometheus, Grafana
# and pgAdmin are not deployed: tracing is switched off with OTEL_SDK_DISABLED and logs go to
# CloudWatch.

locals {
  api_port = 3000

  rabbitmq_host = "rabbitmq.${aws_service_discovery_private_dns_namespace.main.name}"
}

resource "aws_ecr_repository" "app" {
  name                 = "${local.name}-app"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # Destroy also removes the pushed images

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

# One group for every container; each service writes under its own stream prefix.
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}-app"
  retention_in_days = var.log_retention_days
}

# --- Secrets (SSM SecureString, AWS-managed key) -------------------------------------------
# RABBITMQ_URL embeds its password, so it is a secret as a whole.

resource "random_password" "api_key" {
  length  = 40
  special = false
}

resource "random_password" "rabbitmq" {
  length  = 32
  special = false # goes into a URL unescaped
}

locals {
  secrets = {
    API_KEY               = random_password.api_key.result
    RABBITMQ_URL          = "amqp://app:${random_password.rabbitmq.result}@${local.rabbitmq_host}:5672"
    RABBITMQ_DEFAULT_PASS = random_password.rabbitmq.result
  }
}

resource "aws_ssm_parameter" "secret" {
  for_each = toset(["API_KEY", "RABBITMQ_URL", "RABBITMQ_DEFAULT_PASS"])

  name  = "/${local.name}/${each.key}"
  type  = "SecureString"
  value = local.secrets[each.key]
}

# --- IAM -------------------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS to pull the images, write logs and inject the secrets as environment variables.
# None of the containers calls an AWS API, so there is no task role.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-app-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "AppSecrets"
    actions   = ["ssm:GetParameters"]
    resources = [for parameter in aws_ssm_parameter.secret : parameter.arn]
  }

  statement {
    sid       = "DatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# --- ECS cluster and service discovery -------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${local.name}.internal"
  description = "Private DNS names of ${local.name} services"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "rabbitmq" {
  name = "rabbitmq"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

# --- RabbitMQ ----------------------------------------------------------------------------------
# A single broker without persistence across task restarts: fine for a demo, and the reason
# the deploy waits for it before starting the workers (they exit when the connection drops and
# ECS restarts them, like `restart: unless-stopped` in docker-compose).

resource "aws_ecs_task_definition" "rabbitmq" {
  family                   = "${local.name}-rabbitmq"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512 # the Erlang VM boots slowly on 0.25 vCPU
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "rabbitmq"
    image     = var.rabbitmq_image
    essential = true

    portMappings = [{ containerPort = 5672, protocol = "tcp" }]

    # The built-in guest user only works from localhost.
    environment = [{ name = "RABBITMQ_DEFAULT_USER", value = "app" }]
    secrets     = [{ name = "RABBITMQ_DEFAULT_PASS", valueFrom = aws_ssm_parameter.secret["RABBITMQ_DEFAULT_PASS"].arn }]

    # As the rabbitmq user, not root: the server runs as rabbitmq (the image's entrypoint
    # drops privileges), and both share the Erlang cookie at /var/lib/rabbitmq/.erlang.cookie.
    # A check run as root before the server has started creates that file owned by root
    # (mode 0400), and the server then dies with "Error when reading .erlang.cookie: eacces".
    healthCheck = {
      command     = ["CMD-SHELL", "su-exec rabbitmq rabbitmq-diagnostics -q ping"]
      interval    = 30
      timeout     = 20
      retries     = 3
      startPeriod = 90
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "rabbitmq"
      }
    }
  }])
}

resource "aws_ecs_service" "rabbitmq" {
  name            = "${local.name}-rabbitmq"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.rabbitmq.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Never two brokers at once: the old task stops before the new one starts.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.rabbitmq.id]
    assign_public_ip = true # pulls the image from ECR Public without a NAT gateway
  }

  service_registries {
    registry_arn = aws_service_discovery_service.rabbitmq.arn
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # The API and workers below are only created once the broker is healthy and registered.
  wait_for_steady_state = true

  depends_on = [aws_iam_role_policy.execution_secrets]
}

# --- API and workers ---------------------------------------------------------------------------

locals {
  common_environment = [
    { name = "NODE_ENV", value = "production" },
    # No OTLP collector is deployed (see the top of this file).
    { name = "OTEL_SDK_DISABLED", value = "true" },
    { name = "DB_HOST", value = aws_db_instance.main.address },
    { name = "DB_PORT", value = tostring(aws_db_instance.main.port) },
    { name = "DB_NAME", value = aws_db_instance.main.db_name },
    { name = "DB_USER", value = aws_db_instance.main.username },
    { name = "DB_SSL", value = "true" },
    { name = "RABBITMQ_EXCHANGE", value = "ddd_project.events" },
  ]

  # Every process connects to PostgreSQL (and runs pending migrations under an advisory lock).
  db_password = { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" }

  services = {
    api = {
      command = ["node", "dist/api/server.js"]
      secrets = ["API_KEY", "RABBITMQ_URL"]
      environment = [
        { name = "PORT", value = tostring(local.api_port) },
        { name = "OTEL_SERVICE_NAME", value = "ddd-cqrs-rabbitmq-app" },
        # CloudFront, then the ALB: the client IP is two X-Forwarded-For hops back.
        { name = "TRUST_PROXY", value = "2" },
      ]
    }
    consumer = {
      command     = ["node", "dist/consumer.js"]
      secrets     = ["RABBITMQ_URL"]
      environment = [{ name = "OTEL_SERVICE_NAME", value = "ddd-cqrs-rabbitmq-consumer" }]
    }
    outbox-relay = {
      command     = ["node", "dist/outbox-relay.js"]
      secrets     = ["RABBITMQ_URL"]
      environment = [{ name = "OTEL_SERVICE_NAME", value = "ddd-cqrs-rabbitmq-outbox-relay" }]
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each = local.services

  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
    essential = true
    command   = each.value.command

    # tini as PID 1, like `init: true` in docker-compose.
    linuxParameters = { initProcessEnabled = true }

    portMappings = each.key == "api" ? [{ containerPort = local.api_port, protocol = "tcp" }] : []

    environment = concat(local.common_environment, each.value.environment)
    secrets     = concat([for key in each.value.secrets : { name = key, valueFrom = aws_ssm_parameter.secret[key].arn }], [local.db_password])

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_lb" "app" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = local.api_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 10

  # Liveness, not /health/ready: a slow dependency must not make the ALB drain a healthy process.
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# /metrics is unauthenticated (meant for Prometheus inside the network): not exposed publicly.
resource "aws_lb_listener_rule" "hide_metrics" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/metrics", "/metrics/*"]
    }
  }

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not found\"}"
      status_code  = "404"
    }
  }
}

resource "aws_ecs_service" "this" {
  for_each = local.services

  name            = "${local.name}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.this[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Migrations run on API startup, before the server listens.
  health_check_grace_period_seconds = each.key == "api" ? 60 : null

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true # reaches ECR and SSM without a NAT gateway
  }

  dynamic "load_balancer" {
    for_each = each.key == "api" ? [1] : []

    content {
      target_group_arn = aws_lb_target_group.api.arn
      container_name   = "api"
      container_port   = local.api_port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http, aws_iam_role_policy.execution_secrets, aws_ecs_service.rabbitmq]
}
