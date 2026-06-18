const { EntitySchema } = require('typeorm');

const User = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    email: { type: 'varchar', length: 255, unique: true },
    password_hash: { type: 'varchar', length: 255 },
    name: { type: 'varchar', length: 255 },
    phone: { type: 'varchar', length: 30, nullable: true },
    is_active: { type: 'boolean', default: true },
    profile_image_url: { type: 'varchar', length: 500, nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const UserImage = new EntitySchema({
  name: 'UserImage',
  tableName: 'user_images',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    user_id: { type: 'uuid' },
    image_url: { type: 'varchar', length: 500 },
    uploaded_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
  },
});

const Role = new EntitySchema({
  name: 'Role',
  tableName: 'roles',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: 'varchar', length: 100 },
    display_name: { type: 'varchar', length: 100 },
    level: { type: 'int' },
    entity_id: { type: 'uuid', nullable: true },
    entity_type: { type: 'varchar', length: 50, default: 'any' },
    permissions: { type: 'jsonb', default: {} },
    is_system: { type: 'boolean', default: false },
    parent_role_id: { type: 'uuid', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const UserRoleAssignment = new EntitySchema({
  name: 'UserRoleAssignment',
  tableName: 'user_role_assignments',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    user_id: { type: 'uuid' },
    role_id: { type: 'uuid' },
    scope_type: { type: 'varchar', length: 50 },
    scope_id: { type: 'uuid', nullable: true },
    assigned_by: { type: 'uuid', nullable: true },
    assigned_at: { type: 'timestamptz', createDate: true },
    expires_at: { type: 'timestamptz', nullable: true },
  },
  relations: {
    role: {
      type: 'many-to-one',
      target: 'Role',
      joinColumn: { name: 'role_id' },
    },
    user: {
      type: 'many-to-one',
      target: 'User',
      joinColumn: { name: 'user_id' },
    },
  },
});

const Tower = new EntitySchema({
  name: 'Tower',
  tableName: 'towers',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: 'varchar', length: 255 },
    address: { type: 'text', nullable: true },
    image_url: { type: 'varchar', length: 500, nullable: true },
    notify_channels: { type: 'jsonb', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const Organization = new EntitySchema({
  name: 'Organization',
  tableName: 'organizations',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: 'varchar', length: 255 },
    address: { type: 'text', nullable: true },
    image_url: { type: 'varchar', length: 500, nullable: true },
    notify_channels: { type: 'jsonb', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const Company = new EntitySchema({
  name: 'Company',
  tableName: 'companies',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    tower_id: { type: 'uuid', nullable: true },
    name: { type: 'varchar', length: 255 },
    address: { type: 'text', nullable: true },
    image_url: { type: 'varchar', length: 500, nullable: true },
    approval_chain: { type: 'jsonb', nullable: true },
    notify_channels: { type: 'jsonb', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
  relations: {
    tower: {
      type: 'many-to-one',
      target: 'Tower',
      joinColumn: { name: 'tower_id' },
    },
  },
});

const Location = new EntitySchema({
  name: 'Location',
  tableName: 'locations',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    organization_id: { type: 'uuid', nullable: true },
    name: { type: 'varchar', length: 255 },
    address: { type: 'text', nullable: true },
    image_url: { type: 'varchar', length: 500, nullable: true },
    approval_chain: { type: 'jsonb', nullable: true },
    notify_channels: { type: 'jsonb', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
  relations: {
    organization: {
      type: 'many-to-one',
      target: 'Organization',
      joinColumn: { name: 'organization_id' },
    },
  },
});

const Employee = new EntitySchema({
  name: 'Employee',
  tableName: 'employees',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    entity_type: { type: 'varchar', length: 20 },
    entity_id: { type: 'uuid' },
    employee_code: { type: 'varchar', length: 50, nullable: true },
    name: { type: 'varchar', length: 255 },
    email: { type: 'varchar', length: 255, nullable: true },
    phone: { type: 'varchar', length: 30, nullable: true },
    department: { type: 'varchar', length: 100, nullable: true },
    job_title: { type: 'varchar', length: 100, nullable: true },
    is_active: { type: 'boolean', default: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const Visitor = new EntitySchema({
  name: 'Visitor',
  tableName: 'visitors',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    entity_type: { type: 'varchar', length: 20 },
    entity_id: { type: 'uuid' },
    full_name: { type: 'varchar', length: 255 },
    email: { type: 'varchar', length: 255, nullable: true },
    phone: { type: 'varchar', length: 30, nullable: true },
    company_name: { type: 'varchar', length: 255, nullable: true },
    id_type: { type: 'varchar', length: 50, nullable: true },
    id_number: { type: 'varchar', length: 100, nullable: true },
    purpose: { type: 'text', nullable: true },
    host_name: { type: 'varchar', length: 255, nullable: true },
    host_employee_id: { type: 'uuid', nullable: true },
    status: { type: 'varchar', length: 30, default: 'pending' },
    scheduled_arrival: { type: 'timestamptz', nullable: true },
    scheduled_departure: { type: 'timestamptz', nullable: true },
    checked_in_at: { type: 'timestamptz', nullable: true },
    checked_out_at: { type: 'timestamptz', nullable: true },
    notes: { type: 'text', nullable: true },
    created_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
    updated_at: { type: 'timestamptz', updateDate: true },
  },
});

const EntityImage = new EntitySchema({
  name: 'EntityImage',
  tableName: 'entity_images',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    entity_type: { type: 'varchar', length: 20 },
    entity_id: { type: 'uuid' },
    image_url: { type: 'varchar', length: 500 },
    uploaded_by: { type: 'uuid', nullable: true },
    created_at: { type: 'timestamptz', createDate: true },
  },
});

const TABLE_TO_ENTITY = {
  towers: 'Tower',
  companies: 'Company',
  organizations: 'Organization',
  locations: 'Location',
};

const ENTITY_TYPE_TO_REPO = {
  tower: 'Tower',
  company: 'Company',
  organization: 'Organization',
  location: 'Location',
};

module.exports = {
  User,
  UserImage,
  Role,
  UserRoleAssignment,
  Tower,
  Organization,
  Company,
  Location,
  Employee,
  Visitor,
  EntityImage,
  TABLE_TO_ENTITY,
  ENTITY_TYPE_TO_REPO,
  entities: [
    User,
    UserImage,
    Role,
    UserRoleAssignment,
    Tower,
    Organization,
    Company,
    Location,
    Employee,
    Visitor,
    EntityImage,
  ],
};
