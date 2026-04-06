/**
 * Simple Logger Utility
 * In a real production app, this would use Winston or Pino.
 */
const Logger = {
  info: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO]: ${message}`, Object.keys(meta).length ? meta : "");
  },
  error: (message, error = {}) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR]: ${message}`, {
      message: error.message,
      stack: error.stack,
      ...error
    });
  },
  warn: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN]: ${message}`, meta);
  }
};

export default Logger;
