import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { MetricsController } from './metrics.controller';
import { LoggingMiddleware } from './common/logging.middleware';

@Module({
  controllers: [AppController, MetricsController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 모든 라우트에 로깅 + 메트릭 미들웨어 적용
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
