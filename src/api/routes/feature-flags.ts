import type { FastifyInstance } from 'fastify';

/**
 * Feature flags endpoint for frontend runtime configuration.
 *
 * This allows changing donation limits, enabling/disabling features,
 * and adding kill switches WITHOUT redeploying code.
 *
 * ## Usage
 * Frontend fetches `/api/feature-flags` on boot and uses the values
 * to configure components. For example:
 *   - Disable donations if Stripe has an outage
 *   - Adjust min/max donation amounts for campaigns
 *   - Toggle upcoming features
 *
 * ## Configuration
 * In v1, flags are read from environment variables with sensible defaults.
 * In v2, this could be backed by LaunchDarkly, Redis, or a DB table.
 *
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

export interface FeatureFlags {
    donations: {
        enabled: boolean;
        minAmount: number;
        maxAmount: number;
        allowRecurring: boolean;
    };
    contactForm: {
        enabled: boolean;
    };
    maintenance: {
        enabled: boolean;
        message: string;
    };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return value === 'true' || value === '1';
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getFeatureFlags(env: Record<string, string | undefined>): FeatureFlags {
    return {
        donations: {
            enabled: parseBoolean(env.FF_DONATIONS_ENABLED, true),
            minAmount: parseNumber(env.FF_DONATIONS_MIN_AMOUNT, 500), // cents
            maxAmount: parseNumber(env.FF_DONATIONS_MAX_AMOUNT, 1_000_000), // cents
            allowRecurring: parseBoolean(env.FF_DONATIONS_ALLOW_RECURRING, true),
        },
        contactForm: {
            enabled: parseBoolean(env.FF_CONTACT_FORM_ENABLED, true),
        },
        maintenance: {
            enabled: parseBoolean(env.FF_MAINTENANCE_MODE, false),
            message: env.FF_MAINTENANCE_MESSAGE || '',
        },
    };
}

export async function featureFlagRoutes(app: FastifyInstance) {
    app.get('/feature-flags', async (req, reply) => {
        const flags = getFeatureFlags(process.env);

        // Cache for 60 seconds — frequent enough to propagate kill switches quickly,
        // but not so frequent that it hammers the server on every page load.
        reply.header('Cache-Control', 'public, max-age=60, s-maxage=60');

        return { ok: true, data: flags };
    });
}
