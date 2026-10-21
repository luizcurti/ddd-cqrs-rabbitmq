import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

const defaultLevel = isTest ? "silent" : "info";

const logger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      }
    : undefined,
});

export default logger;
