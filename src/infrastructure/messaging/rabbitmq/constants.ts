export const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
export const EVENTS_EXCHANGE = process.env.RABBITMQ_EXCHANGE || "ddd_project.events";
