import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, rm, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Post } from './entities/post.entity';
import { PostLike } from './entities/post-like.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostMedia, PostMediaType } from './entities/post-media.entity';

const MAX_MEDIA_PER_POST = 4;

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE = 50 * 1024 * 1024;

const MEDIA_RULES: Record<
  string,
  {
    type: PostMediaType;
    maxSize: number;
    allowedExtensions: string[];
  }
> = {
  'image/jpeg': {
    type: PostMediaType.IMAGE,
    maxSize: IMAGE_MAX_SIZE,
    allowedExtensions: ['.jpg', '.jpeg'],
  },
  'image/png': {
    type: PostMediaType.IMAGE,
    maxSize: IMAGE_MAX_SIZE,
    allowedExtensions: ['.png'],
  },
  'image/webp': {
    type: PostMediaType.IMAGE,
    maxSize: IMAGE_MAX_SIZE,
    allowedExtensions: ['.webp'],
  },
  'video/mp4': {
    type: PostMediaType.VIDEO,
    maxSize: VIDEO_MAX_SIZE,
    allowedExtensions: ['.mp4'],
  },
  'video/webm': {
    type: PostMediaType.VIDEO,
    maxSize: VIDEO_MAX_SIZE,
    allowedExtensions: ['.webm'],
  },
  'video/quicktime': {
    type: PostMediaType.VIDEO,
    maxSize: VIDEO_MAX_SIZE,
    allowedExtensions: ['.mov'],
  },
};

type ValidatedUpload = {
  file: Express.Multer.File;
  type: PostMediaType;
  ext: string;
};

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(PostLike)
    private readonly postLikesRepository: Repository<PostLike>,
    @InjectRepository(PostMedia)
    private readonly postMediaRepository: Repository<PostMedia>,
  ) {}

  async createPost(
    userId: number,
    postData: CreatePostDto,
    mediaFiles: Express.Multer.File[] = [],
  ) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const validatedFiles = this.validateMediaFiles(mediaFiles);

    const savedUrls: string[] = [];

    try {
      const postId = await this.postRepository.manager.transaction(
        async (manager) => {
          const postRepository = manager.getRepository(Post);
          const postMediaRepository = manager.getRepository(PostMedia);

          const post = postRepository.create({
            ...postData,
            user,
          });

          const savedPost = await postRepository.save(post);

          if (validatedFiles.length) {
            const mediaRows = await this.saveMediaFilesToDisk(
              savedPost.id,
              validatedFiles,
              0,
              savedUrls,
            );

            await postMediaRepository.save(mediaRows);
          }

          return savedPost.id;
        },
      );

      return this.findPostById(postId);
    } catch (error) {
      await this.deleteFilesByUrls(savedUrls);
      await this.removePostMediaFolderIfEmpty();
      throw error;
    }
  }

  async findAllPosts(currentUserId?: number) {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.user', 'user')
      .leftJoinAndSelect('user.profile', 'profile')
      .leftJoinAndSelect('post.media', 'media')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'likes_count')
          .from('post_likes', 'pl')
          .where('pl.post_id = post.id');
      }, 'likesCount')
      .orderBy('post.id', 'DESC')
      .addOrderBy('media.order', 'ASC')
      .getMany();

    return this.attachCurrentUserLiked(posts, currentUserId);
  }

  async findPostById(postId: number, currentUserId?: number) {
    const post = await this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.user', 'user')
      .leftJoinAndSelect('user.profile', 'profile')
      .leftJoinAndSelect('post.comments', 'comments')
      .leftJoinAndSelect('comments.user', 'commentUser')
      .leftJoinAndSelect('commentUser.profile', 'commentUserProfile')
      .leftJoinAndSelect('post.media', 'media')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'likes_count')
          .from('post_likes', 'pl')
          .where('pl.post_id = post.id');
      }, 'likesCount')
      .where('post.id = :postId', { postId })
      .orderBy('comments.createdAt', 'DESC')
      .addOrderBy('media.order', 'ASC')
      .getOne();

    if (!post) {
      throw new NotFoundException(`Post with id ${postId} not found`);
    }

    await this.attachCurrentUserLiked([post], currentUserId);
    return post;
  }

  async findPostsByAuthorId(authorId: number, currentUserId?: number) {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.user', 'user')
      .leftJoinAndSelect('user.profile', 'profile')
      .leftJoinAndSelect('post.media', 'media')
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)', 'likes_count')
          .from('post_likes', 'pl')
          .where('pl.post_id = post.id');
      }, 'likesCount')
      .where('user.id = :authorId', { authorId })
      .orderBy('post.id', 'DESC')
      .addOrderBy('media.order', 'ASC')
      .getMany();

    return this.attachCurrentUserLiked(posts, currentUserId);
  }

  async updatePost(
    postId: number,
    userId: number,
    updatePostDto: UpdatePostDto,
    newMediaFiles: Express.Multer.File[] = [],
  ) {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: { user: true, media: true },
      order: { media: { order: 'ASC' } },
    });

    if (!post) {
      throw new NotFoundException(`Post with id ${postId} not found`);
    }

    if (post.user.id !== userId) {
      throw new ForbiddenException('You can edit only your own post');
    }

    const validatedFiles = this.validateMediaFiles(newMediaFiles);
    const removeMediaIds = updatePostDto.removeMediaIds ?? [];

    const existingMediaMap = new Map(post.media.map((item) => [item.id, item]));

    for (const mediaId of removeMediaIds) {
      if (!existingMediaMap.has(mediaId)) {
        throw new BadRequestException(
          `Media with id ${mediaId} does not belong to post ${postId}`,
        );
      }
    }

    const removeSet = new Set(removeMediaIds);
    const remainingMedia = post.media.filter((item) => !removeSet.has(item.id));

    if (remainingMedia.length + validatedFiles.length > MAX_MEDIA_PER_POST) {
      throw new BadRequestException(
        `Maximum ${MAX_MEDIA_PER_POST} media files are allowed per post`,
      );
    }

    const removedUrls = post.media
      .filter((item) => removeSet.has(item.id))
      .map((item) => item.url);

    const savedUrls: string[] = [];

    try {
      await this.postRepository.manager.transaction(async (manager) => {
        const postRepository = manager.getRepository(Post);
        const postMediaRepository = manager.getRepository(PostMedia);

        if (typeof updatePostDto.title === 'string') {
          post.title = updatePostDto.title;
        }

        if (typeof updatePostDto.content === 'string') {
          post.content = updatePostDto.content;
        }

        await postRepository.save(post);

        if (removeMediaIds.length) {
          await postMediaRepository.delete(removeMediaIds);
        }

        const reorderedRemaining = remainingMedia
          .sort((a, b) => a.order - b.order)
          .map((item, index) => {
            item.order = index;
            return item;
          });

        if (reorderedRemaining.length) {
          await postMediaRepository.save(reorderedRemaining);
        }

        if (validatedFiles.length) {
          const newMediaRows = await this.saveMediaFilesToDisk(
            postId,
            validatedFiles,
            reorderedRemaining.length,
            savedUrls,
          );

          await postMediaRepository.save(newMediaRows);
        }
      });
    } catch (error) {
      await this.deleteFilesByUrls(savedUrls);
      throw error;
    }

    await this.deleteFilesByUrls(removedUrls);

    return this.findPostById(postId);
  }

  async deletePost(postId: number, userId: number) {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: { user: true, media: true },
    });

    if (!post) {
      throw new NotFoundException(`Post with id ${postId} not found`);
    }

    if (post.user.id !== userId) {
      throw new ForbiddenException('You can delete only your own post');
    }

    const mediaUrls = post.media.map((item) => item.url);

    await this.postRepository.delete(postId);
    await this.deleteFilesByUrls(mediaUrls);
    await this.deletePostMediaFolder(postId);

    return { message: `Post with id ${postId} deleted` };
  }

  async toggleLike(userId: number, postId: number) {
    const existingLike = await this.postLikesRepository.findOne({
      where: { post: { id: postId }, user: { id: userId } },
    });

    if (existingLike) {
      await this.postLikesRepository.delete(existingLike.id);
      await this.postRepository.increment({ id: postId }, 'likesCount', -1);
      return { liked: false, likesCount: await this.getLikesCount(postId) };
    } else {
      await this.postLikesRepository.save({
        post: { id: postId },
        user: { id: userId },
      });
      await this.postRepository.increment({ id: postId }, 'likesCount', 1);
      return { liked: true, likesCount: await this.getLikesCount(postId) };
    }
  }

  private async getLikesCount(postId: number): Promise<number> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      select: ['likesCount'],
    });
    return post?.likesCount ?? 0;
  }

  private async attachCurrentUserLiked(posts: Post[], currentUserId?: number) {
    if (!posts.length) {
      return posts;
    }

    if (!currentUserId) {
      for (const post of posts) {
        post.currentUserLiked = false;
      }

      return posts;
    }

    const postIds = posts.map((post) => post.id);
    const likedRows = await this.postRepository.query(
      `
      SELECT p.id AS "postId",
             EXISTS(
               SELECT 1
               FROM post_likes pl
               WHERE pl.post_id = p.id
                 AND pl.user_id = $1
             ) AS "currentUserLiked"
      FROM posts p
      WHERE p.id = ANY($2::int[])
      `,
      [currentUserId, postIds],
    );

    const likedMap = new Map<number, boolean>(
      likedRows.map(
        (row: { postId: number; currentUserLiked: boolean | string }) => [
          Number(row.postId),
          row.currentUserLiked === true || row.currentUserLiked === 't',
        ],
      ),
    );

    for (const post of posts) {
      post.currentUserLiked = likedMap.get(post.id) ?? false;
    }

    return posts;
  }

  private validateMediaFiles(files: Express.Multer.File[]) {
    if (files.length > MAX_MEDIA_PER_POST) {
      throw new BadRequestException(
        `Maximum ${MAX_MEDIA_PER_POST} media files are allowed per request`,
      );
    }

    return files.map((file) => {
      const ext = extname(file.originalname).toLowerCase();
      const rule = MEDIA_RULES[file.mimetype];

      if (!rule || !rule.allowedExtensions.includes(ext)) {
        throw new BadRequestException(
          `Unsupported media file: ${file.originalname}. Allowed types: jpg/jpeg/png/webp/mp4/webm/mov`,
        );
      }

      if (file.size > rule.maxSize) {
        const maxSizeMb = Math.floor(rule.maxSize / (1024 * 1024));
        throw new BadRequestException(
          `File ${file.originalname} exceeds max size ${maxSizeMb}MB`,
        );
      }

      if (!file.buffer) {
        throw new BadRequestException(
          `File ${file.originalname} is missing in-memory buffer`,
        );
      }

      return {
        file,
        type: rule.type,
        ext,
      } as ValidatedUpload;
    });
  }

  private async saveMediaFilesToDisk(
    postId: number,
    files: ValidatedUpload[],
    startOrder: number,
    savedUrls: string[],
  ) {
    const postFolder = this.getPostFolderPath(postId);
    await mkdir(postFolder, { recursive: true });

    const rows: PostMedia[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const { file, type, ext } = files[index];
      const filename = this.buildSafeFilename(file.originalname, ext);
      const absolutePath = join(postFolder, filename);
      await writeFile(absolutePath, file.buffer);

      const relativeUrl = `/uploads/posts/${postId}/${filename}`;
      savedUrls.push(relativeUrl);

      const mediaRow = this.postMediaRepository.create({
        type,
        url: relativeUrl,
        mimeType: file.mimetype,
        size: file.size,
        order: startOrder + index,
        post: { id: postId } as Post,
      });

      rows.push(mediaRow);
    }

    return rows;
  }

  private buildSafeFilename(originalName: string, ext: string) {
    const stem = originalName.slice(0, originalName.length - ext.length);
    const sanitizedStem = stem
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    const safeStem = sanitizedStem || 'file';
    const uniqueSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    return `${uniqueSuffix}-${safeStem}${ext}`;
  }

  private getPostFolderPath(postId: number) {
    return resolve(process.cwd(), 'uploads', 'posts', String(postId));
  }

  private resolveUploadPath(relativeUrl: string) {
    const normalized = relativeUrl.startsWith('/')
      ? relativeUrl.slice(1)
      : relativeUrl;

    const uploadsRoot = resolve(process.cwd(), 'uploads');
    const resolvedPath = resolve(process.cwd(), normalized);

    if (
      resolvedPath !== uploadsRoot &&
      !resolvedPath.startsWith(`${uploadsRoot}${sep}`)
    ) {
      throw new BadRequestException('Invalid media path');
    }

    return resolvedPath;
  }

  private async deleteFilesByUrls(urls: string[]) {
    for (const url of urls) {
      try {
        const filePath = this.resolveUploadPath(url);

        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      } catch {
        // swallow FS cleanup errors to avoid breaking API flow
      }
    }
  }

  private async deletePostMediaFolder(postId: number) {
    const folderPath = this.getPostFolderPath(postId);

    if (existsSync(folderPath)) {
      await rm(folderPath, { recursive: true, force: true });
    }
  }

  private async removePostMediaFolderIfEmpty() {
    const rootFolder = resolve(process.cwd(), 'uploads', 'posts');

    if (!existsSync(rootFolder)) {
      return;
    }

    try {
      await rm(rootFolder, { recursive: false });
    } catch {
      // folder is not empty, keep it
    }
  }
}
