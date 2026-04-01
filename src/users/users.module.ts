import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './сontrollers/users.controller';
import { UserProfilesController } from './сontrollers/user-profiles.controller';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserProfile } from './entities/user-profile.entity';

@Module({
  controllers: [UsersController, UserProfilesController],
  providers: [UsersService],
  imports: [
    TypeOrmModule.forFeature([User, UserCredential, UserProfile, RefreshToken]),
  ],
  exports: [UsersService],
})
export class UsersModule {}
