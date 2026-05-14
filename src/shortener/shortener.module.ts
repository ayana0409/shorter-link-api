import { forwardRef, Module } from "@nestjs/common";
import { ShortenerService } from "./shortener.service";
import { ShortenerController } from "./shortener.controller";
import { Shortener, ShortenerSchema } from "./schema/shortener.schema";
import { MongooseModule } from "@nestjs/mongoose/dist/mongoose.module";
import { AccountModule } from "../account/account.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shortener.name, schema: ShortenerSchema },
    ]),
    forwardRef(() => AccountModule),
  ],
  controllers: [ShortenerController],
  providers: [ShortenerService],
  exports: [ShortenerService],
})
export class ShortenerModule {}
