import { VoxError } from "./vox.js";

/** Lets async handlers throw; Express 4 does not catch rejected promises on its own. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (what) => new VoxError(404, `${what} not found`);

export const badRequest = (message) => new VoxError(400, message);
