import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { AuditLogService } from "../../audit-log/audit-log.service";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  /** Endpoints to skip logging (auth, health checks, etc.) */
  private readonly SKIP_LOG_PATTERNS = [
    { method: "POST", path: "/auth/login" },
    { method: "POST", path: "/auth/refresh" },
    { method: "POST", path: "/auth/logout" },
    { method: "GET", path: "/ping" },
    { method: "GET", path: "/health" },
  ];

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const body = request.body
      ? JSON.parse(JSON.stringify(request.body))
      : undefined;
    const user = request.user ? JSON.stringify(request.user) : undefined;
    const startTime = Date.now();

    // Skip logging for auth endpoints, health checks, etc.
    const shouldSkip = this.SKIP_LOG_PATTERNS.some(
      (p) => p.method === method && url.startsWith(p.path),
    );

    return next.handle().pipe(
      tap({
        next: () => {
          if (shouldSkip) return;
          if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            const duration = Date.now() - startTime;
            const parts = [`${method} ${url} completed`, `${duration}ms`];
            if (body) {
              parts.push(`body=${JSON.stringify(body)}`);
            }
            if (user) {
              parts.push(`user=${user}`);
            }
            this.logger.log(parts.join(" "));

            const action =
              method === "POST"
                ? "create"
                : method === "DELETE"
                  ? "delete"
                  : "update";
            const pathSegments = url.split("?")[0].split("/").filter(Boolean);
            const entity = pathSegments[0] || "unknown";
            const entityId = request.params?.id || null;
            const performedBy = request.user?.username || null;
            const performedById = request.user?._id || null;
            const description = `${action.toUpperCase()} ${entity}${entityId ? ` id=${entityId}` : ""}`;

            this.auditLogService
              .createAuditLog({
                action,
                entity,
                entityId,
                description,
                performedBy,
                performedById,
                requestMethod: method,
                requestUrl: url,
                requestBody: body,
              })
              .catch((error) => {
                this.logger.error("Failed to write audit log", error);
              });
          }
        },
      }),
    );
  }
}
