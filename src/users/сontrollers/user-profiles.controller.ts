import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from 'src/common/multer.config';
import { JwtGuard } from 'src/auth/jwt.guard';
import { User } from 'src/common/user.decorator';
import { UsersService } from 'src/users/users.service';
import { ProfileResponseDto } from 'src/users/dto/profile-response.dto';
import { CreateProfileDto } from 'src/users/dto/create-profile.dto';
import { ProfileDto } from 'src/users/dto/profile-response.dto';
import { DeleteProfileImagesDto } from 'src/users/dto/delete-profile-images.dto';

@ApiTags('User Profiles')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('profiles')
export class UserProfilesController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Создать или обновить профиль пользователя' })
  @ApiResponse({
    status: 201,
    description: 'Profile created/updated successfully',
    type: ProfileResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'background', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  async createProfile(
    @User('userId') userId: number,
    @Body() body: CreateProfileDto,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      background?: Express.Multer.File[];
    },
  ) {
    const profileData: CreateProfileDto = { ...body };

    if (files.avatar?.length) {
      profileData.avatar = `/uploads/avatar/${files.avatar[0].filename}`;
    }

    if (files.background?.length) {
      profileData.background = `/uploads/background/${files.background[0].filename}`;
    }

    return this.usersService.createProfile(userId, profileData, files);
  }

  @Get('me')
  @ApiOperation({ summary: 'Получить свой профиль' })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: ProfileDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  getMyProfile(@User('userId') userId: number) {
    return this.usersService.getProfileByUserId(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить профиль пользователя по ID' })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: ProfileDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  getProfile(@Param('id') id: string) {
    return this.usersService.getProfileByUserId(+id);
  }

  @Patch()
  @ApiOperation({ summary: 'Обновить профиль пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ProfileResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'background', maxCount: 1 },
      ],
      multerConfig,
    ),
  )
  async updateProfile(
    @User('userId') userId: number,
    @Body() body: CreateProfileDto,
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      background?: Express.Multer.File[];
    },
  ) {
    const profileData: CreateProfileDto = { ...body };

    if (files.avatar?.length) {
      profileData.avatar = `/uploads/avatar/${files.avatar[0].filename}`;
    }

    if (files.background?.length) {
      profileData.background = `/uploads/background/${files.background[0].filename}`;
    }

    return this.usersService.updateProfile(userId, profileData, files);
  }

  @Delete('images')
  @ApiOperation({ summary: 'Удалить аватар и/или фон профиля' })
  @ApiResponse({
    status: 200,
    description: 'Images deleted successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  deleteProfileImages(
    @User('userId') userId: number,
    @Body() deleteDto: DeleteProfileImagesDto,
  ) {
    return this.usersService.deleteProfileImages(userId, deleteDto);
  }
}
