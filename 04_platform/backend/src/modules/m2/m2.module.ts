import { Module } from '@nestjs/common';
import { M2Controller } from './m2.controller';
import { ShipmentService } from './shipment.service';
import { LegDecompositionService } from './leg-decomposition.service';
import { IngestionService } from './ingestion/ingestion.service';
import { MagentoPlugin, PluginRegistry, ShopifyPlugin } from './ingestion/plugins';
import { TemplateService } from './templates/template.service';
import { SchemaValidator } from './schema/schema-validator.service';
import { StandardsService } from './schema/standards.service';
import { NamespaceRegistry } from './schema/namespace-registry.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';
import { LabelService } from './label/label.service';
import { AnchoringService } from './anchoring/anchoring.service';
import { LegAccessService } from './legs/leg-access.service';
import { RouteTemplateService } from './legs/route-template.service';

/**
 * M2 — Universal Shipment Digitization & Standards (UDS).
 * Epic: 02_epic_domains/epic_m2_shipment_digitization.md.
 * Creation channels (M2-010): REST + batch JSON/CSV + plugins (Shopify/Magento) + templates
 * (M2-013). E-waybill schema (M2-020..025): mode-specific transport, namespaced tags, Incoterms,
 * HS codes, published JSON Schema. Constraints (M2-030..033): handling-code library, commodity
 * auto-tagging, dangerous-goods classification. Plus anchoring, leg decomposition + JRV.
 */
@Module({
  controllers: [M2Controller],
  providers: [
    ShipmentService,
    LegDecompositionService,
    IngestionService,
    TemplateService,
    ShopifyPlugin,
    MagentoPlugin,
    PluginRegistry,
    SchemaValidator,
    StandardsService,
    NamespaceRegistry,
    HsCodeService,
    CommodityTaggingService,
    DangerousGoodsService,
    LabelService,
    AnchoringService,
    LegAccessService,
    RouteTemplateService,
  ],
  exports: [ShipmentService, LegDecompositionService],
})
export class M2Module {}
