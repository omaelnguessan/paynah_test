import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  create(user: Partial<User>): Promise<User> {
    return this.users.save(this.users.create(user));
  }

  findByReference(reference: string, manager?: EntityManager): Promise<User | null> {
    const repository = manager ? manager.getRepository(User) : this.users;
    return repository.findOne({ where: { reference } });
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }
}
