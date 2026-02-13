/**
 * Standardized API response helpers
 */

export const sendSuccess = (res, data, message, statusCode = 200) => {
  const response = {
    success: true,
    data,
    message,
  };
  res.status(statusCode).json(response);
};

export const sendError = (res, error, statusCode = 400) => {
  const response = {
    success: false,
    error,
  };
  res.status(statusCode).json(response);
};
