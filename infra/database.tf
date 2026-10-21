# PostgreSQL 17, the version docker-compose and CI use. The schema comes from the app's own
# migrations, run at startup under an advisory lock (src/infrastructure/database). The master
# password is generated and stored by RDS in Secrets Manager; ECS injects it as DB_PASSWORD, so
# it never appears in Terraform state or the task definitions.
#
# TLS: RDS defaults rds.force_ssl to 1; the app connects with DB_SSL=true (encrypted, without
# verifying the certificate: no CA bundle in the image). The instance is not publicly
# accessible and its security group only admits the API and worker tasks.

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = "ddd_project"
  username                    = "app"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # Demo stack, torn down by the Destroy workflow: no final snapshot, no deletion protection.
  backup_retention_period    = 1
  skip_final_snapshot        = true
  deletion_protection        = false
  apply_immediately          = true
  auto_minor_version_upgrade = true
}
