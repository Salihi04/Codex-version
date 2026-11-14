import { Request, Response } from 'express';

export function sendError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
