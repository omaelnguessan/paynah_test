import { Injectable } from '@nestjs/common';
import {
  FieldErrorDto,
  ReferencePrefix,
  UserNotFoundException,
  ValidationFailedException,
  generateReference,
  isUniqueViolation,
} from '@paynad/shared';
import { CreateUserRequest } from './dto/create-user.request';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

  async create(request: CreateUserRequest): Promise<User> {
    try {
      return await this.users.create({
        reference: generateReference(ReferencePrefix.USER),
        customer_firstname: request.customer_firstname,
        customer_lastname: request.customer_lastname,
        customer_email: request.customer_email.toLowerCase(),
        customer_phone_number: request.customer_phone_number,
        customer_address: request.customer_address ?? null,
        customer_city: request.customer_city ?? null,
        customer_country: request.customer_country?.toUpperCase() ?? null,
        customer_zip_code: request.customer_zip_code ?? null,
      });
    } catch (error) {
      // Uniqueness is enforced by the database, not by a read-then-write check
      // that two concurrent signups would both pass.
      if (isUniqueViolation(error, 'uq_users_email')) {
        throw new ValidationFailedException([
          new FieldErrorDto('customer_email', ['customer_email is already registered']),
        ]);
      }
      throw error;
    }
  }

  async findByReference(reference: string): Promise<User> {
    const user = await this.users.findByReference(reference);
    if (!user) {
      throw new UserNotFoundException({ reference });
    }
    return user;
  }
}
