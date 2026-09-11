/**
 * Simple Logger Utility
 * In a real production app, this would use Winston or Pino.
 */
const Logger = {
  info: (message, meta = {}) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message,
      ...meta,
    }));
  },
  error: (message, error = {}) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message,
      errorMessage: error.message,
      stack: error.stack,
      ...error,
    }));
  },
  warn: (message, meta = {}) => {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "WARN",
      message,
      ...meta,
    }));
  }
};

export default Logger;
