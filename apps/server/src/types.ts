import 'fastify';
import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email?: string;
      type?: string;
    };
    user: {
      sub: string;
      email: string;
      type?: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}

export interface AuthUser {
  id: string;
  email: string;
}
