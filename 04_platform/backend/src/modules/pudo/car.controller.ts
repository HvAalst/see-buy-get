import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { CarKey, CarKeyGuard } from './car-key.guard';
import { CarMessagesService, type CarCaller } from './car-messages.service';
import { CarReadDto, CarReplyDto, CarTokenDto } from './car.dto';
import { CarChatRead, CarChatView, CarReplySent, CarTokenRegistered } from './car.types';

/**
 * MESSAGES IN THE CAR — THE DOORS THE PLAY APP'S NATIVE PART KNOCKS ON (05_engineering/android-auto-messages.md, section
 * 3; the owner, 2026-11-02: "we start with 2").
 *
 * PUBLIC TO THE SIGN-IN GUARD, AND OPEN ONLY TO A CAR KEY: each route is marked @Public so that the one global guard,
 * which takes a sign-in (`Bearer …`), steps aside — and `CarKeyGuard` takes its place, which takes a car key
 * (`Authorization: Car <key>`) and nothing else. A driver's sign-in, a device key, a company key are each refused here;
 * a car key is refused on every other door, which reads only `Bearer`. Each door counts the calls of each key
 * (RateLimitGuard, after the key is known): a car reads a chat when it is woken, and a driver replies a few times an hour.
 *
 * Every answer is the driver's own, never cached: words of a chat.
 */
@Controller('sbg/car')
export class CarController {
  constructor(private readonly car: CarMessagesService) {}

  /** Where Firebase reaches this phone. Told when the key arrives, and again whenever Firebase gives the phone a new token. */
  @Public()
  @UseGuards(CarKeyGuard, RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('token')
  token(@Body() dto: CarTokenDto, @CarKey() caller: CarCaller): CarTokenRegistered {
    return this.car.registerToken(caller, dto.token);
  }

  /** One chat's unread messages, as the car reads them aloud. Asked when the phone is woken: "this chat has news". */
  @Public()
  @UseGuards(CarKeyGuard, RateLimitGuard)
  @RateLimit(60, 60)
  @Header('Cache-Control', 'private, no-store')
  @Get('chats/:conversationId')
  chat(@Param('conversationId') conversationId: string, @CarKey() caller: CarCaller): CarChatView {
    return this.car.unread(caller, conversationId);
  }

  /** A spoken reply, as text — refused as a typed one would be; marked "Sent from the car". */
  @Public()
  @UseGuards(CarKeyGuard, RateLimitGuard)
  @RateLimit(20, 60)
  @Post('chats/:conversationId/reply')
  reply(@Param('conversationId') conversationId: string, @Body() dto: CarReplyDto, @CarKey() caller: CarCaller): CarReplySent {
    return this.car.reply(caller, conversationId, dto.text);
  }

  /** "Mark as read", up to the newest message the car showed. */
  @Public()
  @UseGuards(CarKeyGuard, RateLimitGuard)
  @RateLimit(60, 60)
  @Post('chats/:conversationId/read')
  read(@Param('conversationId') conversationId: string, @Body() dto: CarReadDto, @CarKey() caller: CarCaller): CarChatRead {
    return this.car.markRead(caller, conversationId, dto.seq);
  }
}
