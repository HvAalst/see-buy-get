import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** The `keys` half of a browser PushSubscription — the ECDH public key + auth secret the encryption needs. */
class PushKeysDto {
  @IsString() p256dh!: string;
  @IsString() auth!: string;
}

/** POST /notifications/subscribe — the browser's `pushManager.subscribe(...).toJSON()`, verbatim. */
export class SubscribeDto {
  @IsString() endpoint!: string;
  @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

/** DELETE /notifications/subscribe — the endpoint identifies which device to drop. */
export class UnsubscribeDto {
  @IsString() endpoint!: string;
}
