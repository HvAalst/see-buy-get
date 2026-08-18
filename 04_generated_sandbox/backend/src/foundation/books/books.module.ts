import { Global, Module } from '@nestjs/common';
import { BooksService } from './books.service';

/** Global: every money movement in every module posts here once the call sites are rewired (step 3b). */
@Global()
@Module({
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
