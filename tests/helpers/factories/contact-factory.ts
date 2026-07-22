/**
 * Contact Form Factory
 * Factory for creating test contact form submissions
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { PrismaClient, ContactStatus, ContactPriority } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

export interface ContactConfig {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  phone?: string;
  company?: string;
  status?: ContactStatus;
  priority?: ContactPriority;
  assignedTo?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  phone?: string;
  company?: string;
  status: ContactStatus;
  priority: ContactPriority;
  assignedTo?: string;
  category?: string;
  metadata: Record<string, unknown>;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default contact configuration
 */
const DEFAULT_CONFIG: Required<ContactConfig> = {
  name: faker.person.fullName(),
  email: `contact-${faker.string.uuid()}@agrobridge.test`,
  subject: faker.lorem.sentence(5),
  message: faker.lorem.paragraphs(2),
  phone: faker.phone.number(),
  company: faker.company.name(),
  status: ContactStatus.NEW,
  priority: ContactPriority.MEDIUM,
  assignedTo: '',
  category: 'general',
  metadata: {},
  source: 'website'
};

/**
 * Contact Factory class
 */
export class ContactFactory {
  private prisma: PrismaClient;
  private createdContacts: string[] = [];

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Create a single contact submission
   */
  async create(config: ContactConfig = {}): Promise<Contact> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const contact = await this.prisma.contact.create({
      data: {
        name: mergedConfig.name,
        email: mergedConfig.email,
        subject: mergedConfig.subject,
        message: mergedConfig.message,
        phone: mergedConfig.phone || null,
        company: mergedConfig.company || null,
        status: mergedConfig.status,
        priority: mergedConfig.priority,
        assignedTo: mergedConfig.assignedTo || null,
        category: mergedConfig.category,
        metadata: mergedConfig.metadata,
        source: mergedConfig.source,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    this.createdContacts.push(contact.id);

    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      subject: contact.subject,
      message: contact.message,
      phone: contact.phone || undefined,
      company: contact.company || undefined,
      status: contact.status,
      priority: contact.priority,
      assignedTo: contact.assignedTo || undefined,
      category: contact.category,
      metadata: contact.metadata as Record<string, unknown>,
      source: contact.source || undefined,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    };
  }

  /**
   * Create multiple contact submissions
   */
  async createMany(count: number, config: ContactConfig = {}): Promise<Contact[]> {
    const contacts: Contact[] = [];
    for (let i = 0; i < count; i++) {
      contacts.push(await this.create({
        ...config,
        email: config.email || `contact-${i}-${faker.string.uuid()}@agrobridge.test`
      }));
    }
    return contacts;
  }

  /**
   * Create a high priority contact
   */
  async createHighPriority(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      priority: ContactPriority.HIGH,
      subject: `[URGENT] ${config.subject || faker.lorem.sentence(3)}`
    });
  }

  /**
   * Create a low priority contact
   */
  async createLowPriority(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      priority: ContactPriority.LOW
    });
  }

  /**
   * Create a contact with specific status
   */
  async createWithStatus(status: ContactStatus, config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      status
    });
  }

  /**
   * Create a resolved contact
   */
  async createResolved(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      status: ContactStatus.RESOLVED,
      metadata: {
        ...config.metadata,
        resolvedAt: new Date().toISOString(),
        resolution: faker.lorem.sentence()
      }
    });
  }

  /**
   * Create a contact assigned to a user
   */
  async createAssigned(userId: string, config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      assignedTo: userId,
      status: ContactStatus.IN_PROGRESS,
      metadata: {
        ...config.metadata,
        assignedAt: new Date().toISOString()
      }
    });
  }

  /**
   * Create a donation-related contact
   */
  async createDonationRelated(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      category: 'donation',
      subject: `[Donation Question] ${config.subject || faker.lorem.sentence(3)}`,
      message: `Question about my donation: ${config.message || faker.lorem.paragraph()}`
    });
  }

  /**
   * Create a partnership inquiry
   */
  async createPartnership(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      category: 'partnership',
      subject: `[Partnership Opportunity] ${config.subject || faker.lorem.sentence(3)}`,
      message: `I'm interested in partnering with AgroBridge Foundation: ${config.message || faker.lorem.paragraphs(2)}`,
      priority: ContactPriority.HIGH
    });
  }

  /**
   * Create a volunteer inquiry
   */
  async createVolunteer(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      category: 'volunteer',
      subject: `[Volunteer Application] ${config.subject || faker.lorem.sentence(3)}`,
      message: `I'm interested in volunteering: ${config.message || faker.lorem.paragraphs(1)}`,
      metadata: {
        ...config.metadata,
        availability: 'weekends',
        skills: ['agriculture', 'community outreach']
      }
    });
  }

  /**
   * Create a spam contact
   */
  async createSpam(config: ContactConfig = {}): Promise<Contact> {
    return this.create({
      ...config,
      status: ContactStatus.SPAM,
      subject: 'Buy cheap products now!!!',
      message: faker.lorem.paragraphs(5) + ' Click here: http://spam-site.com',
      metadata: {
        ...config.metadata,
        spamScore: 0.95,
        spamDetectedAt: new Date().toISOString()
      }
    });
  }

  /**
   * Create concurrent contacts (for race condition testing)
   */
  async createConcurrent(count: number, config: ContactConfig = {}): Promise<Contact[]> {
    const promises = Array.from({ length: count }, (_, i) =>
      this.create({
        ...config,
        email: `concurrent-${i}-${Date.now()}@agrobridge.test`
      })
    );
    return Promise.all(promises);
  }

  /**
   * Create contacts with various sources
   */
  async createMultiSource(sources: string[], config: ContactConfig = {}): Promise<Contact[]> {
    return Promise.all(
      sources.map(source =>
        this.create({
          ...config,
          source
        })
      )
    );
  }

  /**
   * Create contacts for a date range
   */
  async createForDateRange(startDate: Date, endDate: Date, count: number, config: ContactConfig = {}): Promise<Contact[]> {
    const contacts: Contact[] = [];
    const timeRange = endDate.getTime() - startDate.getTime();

    for (let i = 0; i < count; i++) {
      const randomTime = startDate.getTime() + Math.random() * timeRange;
      contacts.push(await this.create({
        ...config,
        email: `dated-${i}-${faker.string.uuid()}@agrobridge.test`
      }));
      
      // Update createdAt
      await this.prisma.contact.update({
        where: { id: contacts[i].id },
        data: { createdAt: new Date(randomTime) }
      });
    }

    return contacts;
  }

  /**
   * Get contact by ID
   */
  async findById(id: string): Promise<Contact | null> {
    const contact = await this.prisma.contact.findUnique({
      where: { id }
    });

    if (!contact) return null;

    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      subject: contact.subject,
      message: contact.message,
      phone: contact.phone || undefined,
      company: contact.company || undefined,
      status: contact.status,
      priority: contact.priority,
      assignedTo: contact.assignedTo || undefined,
      category: contact.category,
      metadata: contact.metadata as Record<string, unknown>,
      source: contact.source || undefined,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    };
  }

  /**
   * Get contacts by status
   */
  async findByStatus(status: ContactStatus): Promise<Contact[]> {
    const contacts = await this.prisma.contact.findMany({
      where: { status }
    });

    return contacts.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      subject: c.subject,
      message: c.message,
      phone: c.phone || undefined,
      company: c.company || undefined,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo || undefined,
      category: c.category,
      metadata: c.metadata as Record<string, unknown>,
      source: c.source || undefined,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
  }

  /**
   * Get contacts by assigned user
   */
  async findByAssignedUser(userId: string): Promise<Contact[]> {
    const contacts = await this.prisma.contact.findMany({
      where: { assignedTo: userId }
    });

    return contacts.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      subject: c.subject,
      message: c.message,
      phone: c.phone || undefined,
      company: c.company || undefined,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo || undefined,
      category: c.category,
      metadata: c.metadata as Record<string, unknown>,
      source: c.source || undefined,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
  }

  /**
   * Update contact status
   */
  async updateStatus(id: string, status: ContactStatus, metadata?: Record<string, unknown>): Promise<Contact> {
    const contact = await this.prisma.contact.update({
      where: { id },
      data: {
        status,
        metadata: metadata ? { ...metadata } : undefined,
        updatedAt: new Date()
      }
    });

    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      subject: contact.subject,
      message: contact.message,
      phone: contact.phone || undefined,
      company: contact.company || undefined,
      status: contact.status,
      priority: contact.priority,
      assignedTo: contact.assignedTo || undefined,
      category: contact.category,
      metadata: contact.metadata as Record<string, unknown>,
      source: contact.source || undefined,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    };
  }

  /**
   * Delete a contact
   */
  async delete(contactId: string): Promise<void> {
    await this.prisma.contact.delete({
      where: { id: contactId }
    });
    this.createdContacts = this.createdContacts.filter(id => id !== contactId);
  }

  /**
   * Clean up all created contacts
   */
  async cleanup(): Promise<void> {
    if (this.createdContacts.length === 0) return;

    await this.prisma.contact.deleteMany({
      where: { id: { in: this.createdContacts } }
    });
    this.createdContacts = [];
  }

  /**
   * Generate valid contact data
   */
  generateValidData(): {
    name: string;
    email: string;
    subject: string;
    message: string;
  } {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      subject: faker.lorem.sentence(5),
      message: faker.lorem.paragraphs(2)
    };
  }

  /**
   * Generate invalid contact data for edge case testing
   */
  generateInvalidData(): Array<{data: Partial<ContactConfig>; error: string}> {
    return [
      { data: { name: '' }, error: 'Name is required' },
      { data: { email: '' }, error: 'Email is required' },
      { data: { email: 'not-an-email' }, error: 'Invalid email format' },
      { data: { subject: '' }, error: 'Subject is required' },
      { data: { message: '' }, error: 'Message is required' },
      { data: { name: 'a'.repeat(300) }, error: 'Name too long' },
      { data: { subject: 'a'.repeat(500) }, error: 'Subject too long' },
      { data: { message: 'a'.repeat(10000) }, error: 'Message too long' },
      { data: { email: "<script>alert('xss')</script>@test.com" }, error: 'Invalid email format' },
      { data: { message: "<script>alert('xss')</script>" }, error: 'Invalid characters' },
      { data: { name: "'; DROP TABLE contacts; --" }, error: 'Invalid characters' }
    ];
  }

  /**
   * Generate boundary values for testing
   */
  generateBoundaryValues(): Array<{field: keyof ContactConfig; value: string | number; description: string}> {
    return [
      { field: 'name', value: 'A', description: 'Single character name' },
      { field: 'name', value: 'a'.repeat(100), description: 'Maximum length name' },
      { field: 'subject', value: 'Test', description: 'Short subject' },
      { field: 'subject', value: 'a'.repeat(200), description: 'Maximum length subject' },
      { field: 'message', value: 'Hello', description: 'Short message' },
      { field: 'message', value: 'a'.repeat(5000), description: 'Long message' },
      { field: 'phone', value: '+1-555-123-4567', description: 'Valid phone with dashes' },
      { field: 'phone', value: '+15551234567', description: 'Valid phone without dashes' }
    ];
  }

  /**
   * Generate XSS payloads for security testing
   */
  generateXssPayloads(): Array<{field: keyof ContactConfig; payload: string; description: string}> {
    return [
      { field: 'name', payload: "<script>alert('XSS')</script>", description: 'Script tag in name' },
      { field: 'email', payload: "test@<script>alert(1)</script>.com", description: 'Script in email' },
      { field: 'subject', payload: "<img src=x onerror=alert('XSS')>", description: 'Image onerror in subject' },
      { field: 'message', payload: "<body onload=alert('XSS')>", description: 'Body onload in message' },
      { field: 'company', payload: "<svg onload=alert('XSS')>", description: 'SVG onload in company' }
    ];
  }
}

/**
 * Singleton factory instance
 */
export const contactFactory = new ContactFactory();

/**
 * Create a test contact (convenience function)
 */
export async function createTestContact(config: ContactConfig = {}): Promise<Contact> {
  return contactFactory.create(config);
}

/**
 * Create multiple test contacts (convenience function)
 */
export async function createTestContacts(count: number, config: ContactConfig = {}): Promise<Contact[]> {
  return contactFactory.createMany(count, config);
}

/**
 * Clean up all test contacts
 */
export async function cleanupTestContacts(): Promise<void> {
  return contactFactory.cleanup();
}