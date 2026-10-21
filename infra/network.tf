# A small VPC with two public subnets and no NAT gateway: the ALB and the RDS subnet group need
# two AZs, and the Fargate tasks get a public IP to reach ECR, ECR Public, SSM and Secrets
# Manager (cheaper than a NAT). Nothing but the ALB accepts traffic from outside the VPC:
#   CloudFront -> ALB -> API task
#   API and worker tasks -> PostgreSQL, RabbitMQ

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true # Cloud Map's private DNS namespace needs both
  enable_dns_support   = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# CloudFront's origin-facing IP ranges, as an AWS-managed prefix list.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# --- ALB -----------------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "HTTP from CloudFront only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from CloudFront"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the API task"
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
  referenced_security_group_id = aws_security_group.app.id
}

# --- API and workers -------------------------------------------------------------------------

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "API and worker tasks; only the ALB may connect in"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "From the ALB"
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
  referenced_security_group_id = aws_security_group.alb.id
}

# HTTPS out: ECR, CloudWatch Logs, SSM and Secrets Manager.
resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS to AWS APIs"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "app_to_backends" {
  for_each = {
    postgres = { port = 5432, sg = aws_security_group.db.id }
    rabbitmq = { port = 5672, sg = aws_security_group.rabbitmq.id }
  }

  security_group_id            = aws_security_group.app.id
  description                  = "To ${each.key}"
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  referenced_security_group_id = each.value.sg
}

# --- Backends: each one only admits the API and worker tasks ---------------------------------

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL, reachable only from the API and worker tasks"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-db" }
}

resource "aws_security_group" "rabbitmq" {
  name        = "${local.name}-rabbitmq"
  description = "RabbitMQ, reachable only from the API and worker tasks"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-rabbitmq" }
}

resource "aws_vpc_security_group_ingress_rule" "backend_from_app" {
  for_each = {
    postgres = { port = 5432, sg = aws_security_group.db.id }
    rabbitmq = { port = 5672, sg = aws_security_group.rabbitmq.id }
  }

  security_group_id            = each.value.sg
  description                  = "From the API and worker tasks"
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
  referenced_security_group_id = aws_security_group.app.id
}

# The RabbitMQ task pulls its image from ECR Public and ships logs to CloudWatch.
resource "aws_vpc_security_group_egress_rule" "rabbitmq_https" {
  security_group_id = aws_security_group.rabbitmq.id
  description       = "HTTPS to ECR Public and CloudWatch Logs"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}
