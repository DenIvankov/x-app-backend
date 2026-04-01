import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateUserDto } from 'src/auth/dto/create-user.dto';
import { UpdateUserDto } from 'src/auth/dto/update-user.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserProfile } from './entities/user-profile.entity';
import { User } from './entities/user.entity';
import { CreateProfileDto } from './dto/create-profile.dto';
import { DeleteProfileImagesDto } from './dto/delete-profile-images.dto';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { Express } from 'express';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserCredential)
    private readonly credentialRepository: Repository<UserCredential>,
    @InjectRepository(UserProfile)
    private readonly profileRepository: Repository<UserProfile>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  async create(newUser: CreateUserDto): Promise<User> {
    await this.ensureEmailIsAvailable(newUser.email);

    const { password, ...userData } = newUser;

    const user = await this.userRepository.save(
      this.userRepository.create({
        ...userData,
        phone: '',
      }),
    );

    const passwordHash = await bcrypt.hash(password, 10);
    await this.credentialRepository.save(
      this.credentialRepository.create({
        passwordHash,
        user,
      }),
    );

    await this.profileRepository.save(
      this.profileRepository.create({
        user,
      }),
    );

    return user;
  }

  async findOneByEmail(email: string) {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  async findOneById(id: number) {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`Пользователь с id ${id} не существует`);
    }

    return user;
  }

  async findOneByName(name: string) {
    const user = await this.userRepository.findOne({
      where: { name },
    });

    if (!user) {
      throw new NotFoundException(
        `Пользователь с именем ${name} не существует`,
      );
    }

    return user;
  }

  async findCredentialByUserId(userId: number) {
    return this.credentialRepository.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
    });
  }

  async findRefreshTokenByUserId(userId: number) {
    return this.refreshTokenRepository.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  async updateRefreshToken(userId: number, tokenHash: string, expiresAt: Date) {
    const user = await this.findOneById(userId);
    const existingToken = await this.findRefreshTokenByUserId(userId);

    if (existingToken) {
      existingToken.tokenHash = tokenHash;
      existingToken.expiresAt = expiresAt;

      return this.refreshTokenRepository.save(existingToken);
    }

    return this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        tokenHash,
        expiresAt,
        user,
      }),
    );
  }

  async removeRefreshToken(userId: number) {
    const refreshToken = await this.findRefreshTokenByUserId(userId);

    if (!refreshToken) {
      return { affected: 0 };
    }

    return this.refreshTokenRepository.delete(refreshToken.id);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async delete(id: number): Promise<{ message: string }> {
    const result = await this.userRepository.delete(id);

    if (!result.affected) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    return { message: `Пользователь с id ${id} удален` };
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const { password, ...userData } = updateUserDto;

    if (userData.email) {
      await this.ensureEmailIsAvailable(userData.email, id);
    }

    if (Object.keys(userData).length) {
      const result = await this.userRepository.update(id, userData);

      if (!result.affected) {
        throw new NotFoundException(`User with id ${id} not found`);
      }
    } else {
      await this.findOneById(id);
    }

    if (password) {
      const credential = await this.findCredentialByUserId(id);

      if (!credential) {
        throw new NotFoundException(
          `Credentials for user with id ${id} not found`,
        );
      }

      credential.passwordHash = await bcrypt.hash(password, 10);
      await this.credentialRepository.save(credential);
    }

    return `This action updates a #${id} user`;
  }

  private async ensureEmailIsAvailable(email: string, excludeUserId?: number) {
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser && existingUser.id !== excludeUserId) {
      throw new ConflictException(`User with email ${email} already exists`);
    }
  }

  private removeOldFile(oldPath: string | null) {
    if (!oldPath) return;

    // Убираем ведущий слэш, если есть
    const relativePath = oldPath.startsWith('/')
      ? oldPath.substring(1)
      : oldPath;
    const fullPath = join(process.cwd(), relativePath);

    console.log(`Attempting to delete: ${fullPath}`);

    if (existsSync(fullPath)) {
      try {
        unlinkSync(fullPath);
        console.log(`Successfully deleted: ${fullPath}`);
      } catch (error) {
        console.error(`Failed to delete old file ${fullPath}:`, error);
      }
    } else {
      console.log(`File not found: ${fullPath}`);
    }
  }

  async createProfile(
    userId: number,
    createProfileDto: CreateProfileDto,
    files?: {
      avatar?: Express.Multer.File[];
      background?: Express.Multer.File[];
    },
  ) {
    const user = await this.findOneById(userId);

    const existingProfile = await this.profileRepository.findOne({
      where: { user: { id: userId } },
    });

    if (existingProfile) {
      // Удаляем старый аватар, если загружен новый
      if (files?.avatar?.length && existingProfile.avatar) {
        this.removeOldFile(existingProfile.avatar);
      }
      // Удаляем старый фон, если загружен новый
      if (files?.background?.length && existingProfile.background) {
        this.removeOldFile(existingProfile.background);
      }

      await this.profileRepository.update(existingProfile.id, createProfileDto);
      const updatedProfile = await this.profileRepository.findOne({
        where: { id: existingProfile.id },
      });
      return {
        profile: updatedProfile,
        message: 'Профиль успешно обновлен',
      };
    }

    const profile = this.profileRepository.create({
      ...createProfileDto,
      user,
    });

    const savedProfile = await this.profileRepository.save(profile);

    return {
      profile: savedProfile,
      message: 'Профиль успешно создан',
    };
  }

  async updateProfile(
    userId: number,
    updateProfileDto: CreateProfileDto,
    files?: {
      avatar?: Express.Multer.File[];
      background?: Express.Multer.File[];
    },
  ) {
    const profile = await this.profileRepository.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) {
      throw new NotFoundException(
        `Профиль для пользователя с id ${userId} не найден`,
      );
    }

    // Удаляем старый аватар, если загружен новый
    if (files?.avatar?.length && profile.avatar) {
      this.removeOldFile(profile.avatar);
    }
    // Удаляем старый фон, если загружен новый
    if (files?.background?.length && profile.background) {
      this.removeOldFile(profile.background);
    }

    await this.profileRepository.update(profile.id, updateProfileDto);
    const updatedProfile = await this.profileRepository.findOne({
      where: { id: profile.id },
    });

    return {
      profile: updatedProfile,
      message: 'Профиль успешно обновлен',
    };
  }

  async getProfileByUserId(userId: number) {
    const profile = await this.profileRepository.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
    });

    if (!profile) {
      throw new NotFoundException(
        `Профиль для пользователя с id ${userId} не найден`,
      );
    }

    return { profile };
  }

  async deleteProfileImages(userId: number, deleteDto: DeleteProfileImagesDto) {
    const profile = await this.profileRepository.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) {
      throw new NotFoundException(
        `Профиль для пользователя с id ${userId} не найден`,
      );
    }

    let deletedCount = 0;

    if (deleteDto.deleteAvatar && profile.avatar) {
      this.removeOldFile(profile.avatar);
      profile.avatar = null;
      deletedCount++;
    }

    if (deleteDto.deleteBackground && profile.background) {
      this.removeOldFile(profile.background);
      profile.background = null;
      deletedCount++;
    }

    if (deletedCount > 0) {
      await this.profileRepository.save(profile);
    }

    return {
      message: `Удалено изображений: ${deletedCount}`,
      deletedAvatar: deleteDto.deleteAvatar && profile.avatar === null,
      deletedBackground:
        deleteDto.deleteBackground && profile.background === null,
    };
  }
}

