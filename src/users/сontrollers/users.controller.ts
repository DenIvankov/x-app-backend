import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { CreateUserDto } from 'src/auth/dto/create-user.dto';
import { UpdateUserDto } from 'src/auth/dto/update-user.dto';
import { JwtGuard } from 'src/auth/jwt.guard';
import { SuccessMessageDto } from 'src/common/dto/success-message.dto';
import { UserResponseDto, UsersListDto } from 'src/users/dto/user-response.dto';
import { UsersService } from 'src/users/users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiResponse({
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Get()
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: UsersListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  AllUsers() {
    return this.usersService.findAll();
  }

  @Get('id/:id')
  @ApiParam({ name: 'id', example: 1, description: 'User identifier' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOneById(+id);
  }

  @Get('name/:name')
  @ApiOperation({ summary: '�������� ������������ �� �����' })
  @ApiParam({ name: 'name', example: 'ϸ��', description: 'User name' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOneByName(@Param('name') name: string) {
    return this.usersService.findOneByName(name);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user by id' })
  @ApiParam({ name: 'id', example: 1, description: 'User identifier' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete('id/:id')
  @ApiOperation({ summary: 'Delete user by id' })
  @ApiParam({ name: 'id', example: 1, description: 'User identifier' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully',
    type: SuccessMessageDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  removeId(@Param('id') id: string) {
    return this.usersService.delete(+id);
  }
}
