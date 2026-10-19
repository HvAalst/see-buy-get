import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength } from 'class-validator';

/** Round 11 — where a fleet's own system is told of its work. Empty stops the messages. */
export class FleetSystemDto {
  @IsString() @MaxLength(500) url!: string;
}

/** Round 11 — where its vehicles are, sent to its system: 0 for off, or at most every 1, 5 or 15 minutes a vehicle. */
export class FleetPositionsDto {
  @ApiProperty({ enum: [0, 1, 5, 15] })
  @IsInt()
  @IsIn([0, 1, 5, 15])
  everyMin!: number;
}
