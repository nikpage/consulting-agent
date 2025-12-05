import { SupabaseClient } from '@supabase/supabase-js';

export type TaskResult = {
  success: boolean;
  data?: any;
  error?: string;
};

export class ConsultingLogic {
  private db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async execute(type: string, params: any, projectId: string): Promise<TaskResult> {
    console.log(`[LOGIC] Routing task type: ${type} for Project: ${projectId}`);

    switch (type) {
      case 'financial_audit':
        return this.runFinancialAudit(params, projectId);
      case 'market_scrape':
        return this.runMarketScrape(params, projectId);
      case 'generate_report':
        return this.generateReport(params, projectId);
      default:
        throw new Error(`Unknown consulting task type: ${type}`);
    }
  }

  private async runFinancialAudit(params: any, projectId: string): Promise<TaskResult> {
    console.log('Running Financial Audit logic...');
    if (!params.fiscal_year || !params.revenue) {
      throw new Error("Missing required financial parameters");
    }

    const { data, error } = await this.db.from('financial_metrics').insert({
        project_id: projectId,
        fiscal_year: params.fiscal_year,
        revenue: params.revenue,
        gross_margin: params.gross_margin || 0,
        ebitda: params.ebitda || 0,
        net_income: params.net_income || 0,
        source_document_id: params.source_document_id || null
      }).select().single();

    if (error) throw new Error(`Database Insert Failed: ${error.message}`);
    return { success: true, data: { status: 'Audit Data Ingested', id: data.id } };
  }

  private async runMarketScrape(params: any, projectId: string): Promise<TaskResult> {
    console.log('Running Market Scrape logic...');
    if (!params.competitor_name) throw new Error("Missing competitor_name");

    const { data, error } = await this.db.from('market_data').insert({
        project_id: projectId,
        competitor_name: params.competitor_name,
        pricing_model: params.pricing_model || {},
        market_share_estimate: params.market_share_estimate || 0
      }).select().single();

    if (error) throw new Error(`Database Insert Failed: ${error.message}`);
    return { success: true, data: { status: 'Competitor Tracked', id: data.id } };
  }

  private async generateReport(params: any, projectId: string): Promise<TaskResult> {
    console.log('Generating Report...');
    const { data, error } = await this.db.from('generated_reports').insert({
        project_id: projectId,
        report_type: params.report_type || 'general_summary',
        content_summary: 'Automated generation based on financial_metrics',
        s3_url: `projects/${projectId}/reports/${Date.now()}.pdf`
      }).select().single();

    if (error) throw new Error(`Report Generation Log Failed: ${error.message}`);
    return { success: true, data: { url: data.s3_url } };
  }
}
