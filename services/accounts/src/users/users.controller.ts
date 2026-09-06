import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  ReferencePipe,
  ReferencePrefix,
  ResponseCode,
  ResponseMessage,
} from '@paynad/shared';
import { CreateUserRequest } from './dto/create-user.request';
import { UserResponse } from './dto/user.response';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiEnvelopeResponse({
    status: 201,
    code: ResponseCode.CREATED,
    message: ResponseMessage.CREATED,
    model: UserResponse,
  })
  @ApiEnvelopeResponse({
    status: 400,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
    description: 'Malformed payload, or an email that is already registered',
  })
  async create(@Body() request: CreateUserRequest): Promise<UserResponse> {
    return UserResponse.from(await this.users.create(request));
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Fetch a user by reference' })
  @ApiParam({ name: 'reference', example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: UserResponse,
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.USER_NOT_FOUND,
    message: ResponseMessage.USER_NOT_FOUND,
  })
  async findOne(
    @Param('reference', new ReferencePipe(ReferencePrefix.USER)) reference: string,
  ): Promise<UserResponse> {
    return UserResponse.from(await this.users.findByReference(reference));
  }
}
