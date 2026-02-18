/**
 * Donation Factory
 * Factory for creating test donations with various configurations
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { PrismaClient, DonationStatus, DonationType, PaymentProvider } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

export interface DonationConfig {
  amount?: number;
  currency?: string;
  donorEmail?: string;
  donorName?: string;
  donorPhone?: string;
  campaignId?: string;
  isRecurring?: boolean;
  frequency?: string;
  status?: DonationStatus;
  paymentProvider?: PaymentProvider;
  paymentIntentId?: string;
  isAnonymous?: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface Donation {
  id: string;
  amount: number;
  currency: string;
  donorEmail: string;
  donorName: string;
  donorPhone?: string;
  campaignId?: string;
  isRecurring: boolean;
  frequency?: string;
  status: DonationStatus;
  paymentProvider: PaymentProvider;
  paymentIntentId?: string;
  isAnonymous: boolean;
  message?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default donation configuration
 */
const DEFAULT_CONFIG: Required<DonationConfig> = {
  amount: 100,
  currency: 'USD',
  donorEmail: `donor-${faker.string.uuid()}@agrobridge.test`,
  donorName: faker.person.fullName(),
  donorPhone: faker.phone.number(),
  campaignId: '',
  isRecurring: false,
  frequency: 'monthly',
  status: DonationStatus.COMPLETED,
  paymentProvider: PaymentProvider.STRIPE,
  paymentIntentId: `pi_${faker.string.alphanumeric(24)}`,
  isAnonymous: false,
  message: faker.lorem.sentence(),
  metadata: {}
};

/**
 * Donation Factory class
 */
export class DonationFactory {
  private prisma: PrismaClient;
  private createdDonations: string[] = [];

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Create a single donation
   */
  async create(config: DonationConfig = {}): Promise<Donation> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const donation = await this.prisma.donation.create({
      data: {
        amount: mergedConfig.amount,
        currency: mergedConfig.currency,
        donorEmail: mergedConfig.donorEmail,
        donorName: mergedConfig.donorName,
        donorPhone: mergedConfig.donorPhone,
        campaignId: mergedConfig.campaignId || null,
        isRecurring: mergedConfig.isRecurring,
        frequency: mergedConfig.frequency,
        status: mergedConfig.status,
        paymentProvider: mergedConfig.paymentProvider,
        paymentIntentId: mergedConfig.paymentIntentId,
        isAnonymous: mergedConfig.isAnonymous,
        message: mergedConfig.message,
        metadata: mergedConfig.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    this.createdDonations.push(donation.id);

    return {
      id: donation.id,
      amount: donation.amount,
      currency: donation.currency,
      donorEmail: donation.donorEmail,
      donorName: donation.donorName,
      donorPhone: donation.donorPhone || undefined,
      campaignId: donation.campaignId || undefined,
      isRecurring: donation.isRecurring,
      frequency: donation.frequency || undefined,
      status: donation.status,
      paymentProvider: donation.paymentProvider,
      paymentIntentId: donation.paymentIntentId || undefined,
      isAnonymous: donation.isAnonymous,
      message: donation.message || undefined,
      metadata: donation.metadata as Record<string, unknown>,
      createdAt: donation.createdAt,
      updatedAt: donation.updatedAt
    };
  }

  /**
   * Create multiple donations
   */
  async createMany(count: number, config: DonationConfig = {}): Promise<Donation[]> {
    const donations: Donation[] = [];
    for (let i = 0; i < count; i++) {
      donations.push(await this.create({
        ...config,
        donorEmail: config.donorEmail || `donor-${i}-${faker.string.uuid()}@agrobridge.test`
      }));
    }
    return donations;
  }

  /**
   * Create a one-time donation
   */
  async createOneTime(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      isRecurring: false,
      frequency: undefined
    });
  }

  /**
   * Create a recurring donation
   */
  async createRecurring(frequency: string = 'monthly', config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      isRecurring: true,
      frequency
    });
  }

  /**
   * Create an anonymous donation
   */
  async createAnonymous(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      isAnonymous: true,
      donorName: 'Anonymous Donor'
    });
  }

  /**
   * Create a pending donation
   */
  async createPending(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      status: DonationStatus.PENDING
    });
  }

  /**
   * Create a failed donation
   */
  async createFailed(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      status: DonationStatus.FAILED,
      metadata: {
        ...config.metadata,
        failureReason: 'PAYMENT_DECLINED',
        errorCode: 'card_declined'
      }
    });
  }

  /**
   * Create a refunded donation
   */
  async createRefunded(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      status: DonationStatus.REFUNDED,
      metadata: {
        ...config.metadata,
        refundReason: 'Donor request',
        refundDate: new Date().toISOString()
      }
    });
  }

  /**
   * Create a large donation
   */
  async createLarge(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      amount: faker.number.int({ min: 1000, max: 10000 }),
      metadata: {
        ...config.metadata,
        requiresReview: true,
        reviewed: false
      }
    });
  }

  /**
   * Create a small donation
   */
  async createSmall(config: DonationConfig = {}): Promise<Donation> {
    return this.create({
      ...config,
      amount: faker.number.int({ min: 1, max: 10 })
    });
  }

  /**
   * Create donations for a specific campaign
   */
  async createForCampaign(campaignId: string, count: number, config: DonationConfig = {}): Promise<Donation[]> {
    return this.createMany(count, {
      ...config,
      campaignId
    });
  }

  /**
   * Create concurrent donations (for race condition testing)
   */
  async createConcurrent(count: number, config: DonationConfig = {}): Promise<Donation[]> {
    const promises = Array.from({ length: count }, (_, i) =>
      this.create({
        ...config,
        donorEmail: `concurrent-${i}-${Date.now()}@agrobridge.test`,
        paymentIntentId: `pi_${faker.string.alphanumeric(24)}_${i}`
      })
    );
    return Promise.all(promises);
  }

  /**
   * Create donations with different currencies
   */
  async createMultiCurrency(currencies: string[], config: DonationConfig = {}): Promise<Donation[]> {
    return Promise.all(
      currencies.map(currency =>
        this.create({
          ...config,
          currency
        })
      )
    );
  }

  /**
   * Get donation by ID
   */
  async findById(id: string): Promise<Donation | null> {
    const donation = await this.prisma.donation.findUnique({
      where: { id }
    });

    if (!donation) return null;

    return {
      id: donation.id,
      amount: donation.amount,
      currency: donation.currency,
      donorEmail: donation.donorEmail,
      donorName: donation.donorName,
      donorPhone: donation.donorPhone || undefined,
      campaignId: donation.campaignId || undefined,
      isRecurring: donation.isRecurring,
      frequency: donation.frequency || undefined,
      status: donation.status,
      paymentProvider: donation.paymentProvider,
      paymentIntentId: donation.paymentIntentId || undefined,
      isAnonymous: donation.isAnonymous,
      message: donation.message || undefined,
      metadata: donation.metadata as Record<string, unknown>,
      createdAt: donation.createdAt,
      updatedAt: donation.updatedAt
    };
  }

  /**
   * Get donations by campaign
   */
  async findByCampaign(campaignId: string): Promise<Donation[]> {
    const donations = await this.prisma.donation.findMany({
      where: { campaignId }
    });

    return donations.map(d => ({
      id: d.id,
      amount: d.amount,
      currency: d.currency,
      donorEmail: d.donorEmail,
      donorName: d.donorName,
      donorPhone: d.donorPhone || undefined,
      campaignId: d.campaignId || undefined,
      isRecurring: d.isRecurring,
      frequency: d.frequency || undefined,
      status: d.status,
      paymentProvider: d.paymentProvider,
      paymentIntentId: d.paymentIntentId || undefined,
      isAnonymous: d.isAnonymous,
      message: d.message || undefined,
      metadata: d.metadata as Record<string, unknown>,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt
    }));
  }

  /**
   * Calculate total for a campaign
   */
  async getCampaignTotal(campaignId: string): Promise<number> {
    const result = await this.prisma.donation.aggregate({
      where: {
        campaignId,
        status: DonationStatus.COMPLETED
      },
      _sum: {
        amount: true
      }
    });

    return result._sum.amount || 0;
  }

  /**
   * Delete a donation
   */
  async delete(donationId: string): Promise<void> {
    await this.prisma.donation.delete({
      where: { id: donationId }
    });
    this.createdDonations = this.createdDonations.filter(id => id !== donationId);
  }

  /**
   * Clean up all created donations
   */
  async cleanup(): Promise<void> {
    if (this.createdDonations.length === 0) return;

    await this.prisma.donation.deleteMany({
      where: { id: { in: this.createdDonations } }
    });
    this.createdDonations = [];
  }

  /**
   * Generate valid donation data
   */
  generateValidData(): {
    amount: number;
    currency: string;
    donorEmail: string;
    donorName: string;
  } {
    return {
      amount: faker.number.int({ min: 5, max: 500 }),
      currency: faker.helpers.arrayElement(['USD', 'EUR', 'GBP', 'MXN']),
      donorEmail: faker.internet.email(),
      donorName: faker.person.fullName()
    };
  }

  /**
   * Generate invalid donation data for edge case testing
   */
  generateInvalidData(): Array<{data: Partial<DonationConfig>; error: string}> {
    return [
      { data: { amount: 0 }, error: 'Amount must be positive' },
      { data: { amount: -10 }, error: 'Amount cannot be negative' },
      { data: { amount: 999999999 }, error: 'Amount exceeds maximum' },
      { data: { donorEmail: '' }, error: 'Email is required' },
      { data: { donorEmail: 'not-an-email' }, error: 'Invalid email format' },
      { data: { donorName: '' }, error: 'Name is required' },
      { data: { currency: 'INVALID' }, error: 'Invalid currency' },
      { data: { donorEmail: "<script>alert('xss')</script>@test.com" }, error: 'Invalid email format' },
      { data: { message: "'; DROP TABLE donations; --" }, error: 'Invalid characters in message' }
    ];
  }

  /**
   * Generate boundary values for testing
   */
  generateBoundaryValues(): Array<{amount: number; description: string}> {
    return [
      { amount: 0.01, description: 'Minimum amount' },
      { amount: 1, description: 'Single dollar' },
      { amount: 99.99, description: 'Just under 100' },
      { amount: 100, description: 'Exactly 100' },
      { amount: 999.99, description: 'Just under 1000' },
      { amount: 1000, description: 'Exactly 1000' },
      { amount: 9999.99, description: 'Just under 10000' },
      { amount: 10000, description: 'Maximum allowed' }
    ];
  }
}

/**
 * Singleton factory instance
 */
export const donationFactory = new DonationFactory();

/**
 * Create a test donation (convenience function)
 */
export async function createTestDonation(config: DonationConfig = {}): Promise<Donation> {
  return donationFactory.create(config);
}

/**
 * Create multiple test donations (convenience function)
 */
export async function createTestDonations(count: number, config: DonationConfig = {}): Promise<Donation[]> {
  return donationFactory.createMany(count, config);
}

/**
 * Clean up all test donations
 */
export async function cleanupTestDonations(): Promise<void> {
  return donationFactory.cleanup();
}