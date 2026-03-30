import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtGuard } from 'src/auth/jwt.guard';
import { OptionalJwtGuard } from 'src/auth/optional-jwt.guard';
import { User } from 'src/common/user.decorator';
import { SuccessMessageDto } from 'src/common/dto/success-message.dto';
import { CreatePostDto, CreatePostMultipartDto } from './dto/create-post.dto';
import { PostResponseDto, PostsListDto } from './dto/post-response.dto';
import { UpdatePostDto, UpdatePostMultipartDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Создать пост' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreatePostMultipartDto })
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FilesInterceptor('media', 4, {
      storage: memoryStorage(),
      limits: {
        files: 4,
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  @ApiResponse({
    status: 201,
    description: 'Post created successfully',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  createPost(
    @User('userId') userId: number,
    @Body() post: CreatePostDto,
    @UploadedFiles() mediaFiles: Express.Multer.File[] = [],
  ) {
    if (mediaFiles.length > 4) {
      throw new BadRequestException('Maximum 4 media files are allowed');
    }

    return this.postsService.createPost(userId, post, mediaFiles);
  }

  @Get()
  @ApiOperation({ summary: 'Получить все посты' })
  @UseGuards(OptionalJwtGuard)
  @ApiResponse({
    status: 200,
    description: 'Posts retrieved successfully',
    type: PostsListDto,
  })
  findAllPosts(@User('userId') currentUserId?: number) {
    return this.postsService.findAllPosts(currentUserId);
  }

  @Get('author/:authorId')
  @ApiOperation({ summary: 'Получить посты по ID автора' })
  @UseGuards(OptionalJwtGuard)
  @ApiParam({ name: 'authorId', example: 1, description: 'Author identifier' })
  @ApiResponse({
    status: 200,
    description: 'Author posts retrieved successfully',
    type: PostsListDto,
  })
  findPostsByAuthorId(
    @Param('authorId', ParseIntPipe) authorId: number,
    @User('userId') currentUserId?: number,
  ) {
    return this.postsService.findPostsByAuthorId(authorId, currentUserId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить пост по ID' })
  @UseGuards(OptionalJwtGuard)
  @ApiParam({ name: 'id', example: 1, description: 'Post identifier' })
  @ApiResponse({
    status: 200,
    description: 'Post retrieved successfully',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  findPostById(
    @Param('id', ParseIntPipe) postId: number,
    @User('userId') currentUserId?: number,
  ) {
    return this.postsService.findPostById(postId, currentUserId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Редактировать пост' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdatePostMultipartDto })
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FilesInterceptor('media', 4, {
      storage: memoryStorage(),
      limits: {
        files: 4,
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  @ApiParam({ name: 'id', example: 1, description: 'Post identifier' })
  @ApiResponse({
    status: 200,
    description: 'Post updated successfully',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  updatePost(
    @Param('id', ParseIntPipe) postId: number,
    @User('userId') userId: number,
    @Body() updatePostDto: UpdatePostDto,
    @UploadedFiles() mediaFiles: Express.Multer.File[] = [],
  ) {
    if (mediaFiles.length > 4) {
      throw new BadRequestException('Maximum 4 media files are allowed');
    }

    return this.postsService.updatePost(
      postId,
      userId,
      updatePostDto,
      mediaFiles,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить пост' })
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @ApiParam({ name: 'id', example: 1, description: 'Post identifier' })
  @ApiResponse({
    status: 200,
    description: 'Post deleted successfully',
    type: SuccessMessageDto,
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  deletePost(
    @Param('id', ParseIntPipe) postId: number,
    @User('userId') userId: number,
  ) {
    return this.postsService.deletePost(postId, userId);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Toggle like on post (like/unlike)' })
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @ApiParam({ name: 'id', example: 1, description: 'Post identifier' })
  @ApiResponse({
    status: 200,
    description: 'Like toggled successfully',
    schema: {
      example: {
        liked: true,
        likesCount: 5,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  toggleLike(
    @User('userId') userId: number,
    @Param('id', ParseIntPipe) postId: number,
  ) {
    return this.postsService.toggleLike(userId, postId);
  }
}
