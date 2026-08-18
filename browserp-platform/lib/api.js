import { handleError, json, only, requestId } from "./http.js";

export function endpoint(methods, handler) {
  return async function wrapped(req, res) {
    const id = requestId(req);
    res.setHeader("X-Request-Id", id);
    if (!only(req, res, methods)) return;
    try {
      return await handler(req, res, id);
    } catch (error) {
      return handleError(res, error, id);
    }
  };
}

export function ok(res, payload, status = 200) {
  return json(res, status, payload);
}
