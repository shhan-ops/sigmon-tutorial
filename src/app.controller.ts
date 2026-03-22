import { Controller, Get, Logger } from '@nestjs/common';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  /** 기본 엔드포인트 — 요청 흐름과 로깅 동작을 확인하는 용도 */
  @Get('hello')
  hello() {
    this.logger.log('hello endpoint called');
    return { message: 'hello' };
  }

  /**
   * 의도적 에러 엔드포인트.
   * 전역 예외 필터를 트리거하고 error 레벨 로그를 생성한다.
   * Loki 에러 쿼리 및 OTel 에러 스팬 확인에 활용한다.
   */
  @Get('error')
  error() {
    this.logger.error('error endpoint called — throwing intentionally');
    throw new Error('Intentional error for observability testing');
  }

  /**
   * 지연 응답 엔드포인트 — 300~800ms의 인위적인 레이턴시를 추가한다.
   * Prometheus 히스토그램 버킷과 트레이스 워터폴 뷰 확인에 활용한다.
   */
  @Get('slow')
  async slow() {
    const delayMs = Math.floor(Math.random() * 500) + 300;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    this.logger.log(`slow endpoint resolved after ${delayMs}ms`);
    return { message: 'slow response', delayMs };
  }
}
