import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { MetricsController } from './metrics.controller';
import { LoggingMiddleware } from './common/logging.middleware';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { winstonConfig } from './common/winston.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot(winstonConfig),
  ],
  controllers: [AppController, MetricsController],
  providers: [
    // DI로 등록하여 LoggerService 주입 가능하게 한다
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
