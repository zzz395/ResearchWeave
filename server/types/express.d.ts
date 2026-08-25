import type { User } from "../../shared/contracts/auth";

declare global {
  namespace Express {
    interface Request {
      actor?: User;
    }
  }
}

export {};
