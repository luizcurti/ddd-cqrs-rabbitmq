-- DDD CQRS RabbitMQ — Database Initialization
-- This file is executed when the PostgreSQL container starts for the first time

-- Create database if it doesn't exist (this is handled by POSTGRES_DB env var)
-- CREATE DATABASE IF NOT EXISTS ddd_project;

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create schemas for different domains (optional, following DDD structure)
CREATE SCHEMA IF NOT EXISTS customer_domain;
CREATE SCHEMA IF NOT EXISTS product_domain;
CREATE SCHEMA IF NOT EXISTS order_domain;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA customer_domain TO postgres;
GRANT ALL PRIVILEGES ON SCHEMA product_domain TO postgres;
GRANT ALL PRIVILEGES ON SCHEMA order_domain TO postgres;

-- Create sequences for IDs (if needed)
CREATE SEQUENCE IF NOT EXISTS customer_domain.customer_seq START 1;
CREATE SEQUENCE IF NOT EXISTS product_domain.product_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_domain.order_seq START 1;

-- Log initialization
\echo 'DDD CQRS RabbitMQ database initialized successfully!'