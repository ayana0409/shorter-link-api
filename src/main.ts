import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AccountService } from "./account/account.service";
import { ConfigService } from "@nestjs/config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));
  const configService = app.get(ConfigService);

  const origins = configService.get<string>("CORS_ORIGIN", "").split(";");
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Postman / server-to-server

      if (origins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

  const accountService = app.get(AccountService);
  await accountService.ensureAdminExists(
    configService.get<string>("ADMIN_USERNAME", "admin"),
    configService.get<string>("ADMIN_FULLNAME", "Administrator"),
    configService.get<string>("ADMIN_PASSWORD", "Passw0rd@123"),
  );
  await accountService.ensureDefaultLevelExists();

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port, "0.0.0.0");

  console.log("Running on port", port);
}
bootstrap();
