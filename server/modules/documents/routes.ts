import { Router, type RequestHandler } from "express";
import { z } from "zod";

import {
  documentListQuerySchema,
  documentListResponseSchema,
  documentResponseSchema,
  documentUploadResponseSchema,
} from "../../../shared/contracts/documents";
import { requireActor } from "../auth/middleware";
import type { DocumentService } from "./service";

const spaceParamsSchema = z.object({ spaceId: z.string().uuid() });
const documentParamsSchema = z.object({
  spaceId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export function createDocumentRouter(
  service: DocumentService,
  uploadDocument: RequestHandler,
) {
  const router = Router({ mergeParams: true });

  router.post(
    "/",
    async (request, _response, next) => {
      const { spaceId } = spaceParamsSchema.parse(request.params);
      await service.authorizeUpload(spaceId, requireActor(request).id);
      next();
    },
    uploadDocument,
    async (request, response) => {
      const { spaceId } = spaceParamsSchema.parse(request.params);
      const result = await service.uploadDocument(spaceId, requireActor(request).id, request.file);
      response
        .status(result.created ? 201 : 200)
        .json(documentUploadResponseSchema.parse(result));
    },
  );

  router.get("/", async (request, response) => {
    const { spaceId } = spaceParamsSchema.parse(request.params);
    const query = documentListQuerySchema.parse(request.query);
    const result = await service.listDocuments(spaceId, requireActor(request).id, query);
    response.status(200).json(documentListResponseSchema.parse(result));
  });

  router.get("/:documentId", async (request, response) => {
    const { spaceId, documentId } = documentParamsSchema.parse(request.params);
    const document = await service.getDocument(spaceId, documentId, requireActor(request).id);
    response.status(200).json(documentResponseSchema.parse({ document }));
  });

  router.delete("/:documentId", async (request, response) => {
    const { spaceId, documentId } = documentParamsSchema.parse(request.params);
    await service.deleteDocument(spaceId, documentId, requireActor(request).id);
    response.status(204).end();
  });

  return router;
}

