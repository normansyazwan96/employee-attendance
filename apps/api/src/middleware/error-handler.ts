import type { ErrorRequestHandler, RequestHandler } from "express";

export const requestLogger: RequestHandler = (request, _response, next) => {
  console.info(`${request.method} ${request.originalUrl}`);
  next();
};

export const notFound: RequestHandler = (request, response) => {
  response.status(404).json({ error: `Route ${request.method} ${request.originalUrl} was not found` });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response) => {
  console.error(error);
  response.status(500).json({ error: "An unexpected error occurred" });
};
