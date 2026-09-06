// https://github.com/FauxFaux/factorio-loader/blob/98eb701ed55afb0dc01d40f5b05fb63921fa2eb3/web/muffler/blueprints.ts

export interface Blueprint {
  entities?: Entity[];
  tiles?: { name: string; position?: unknown }[];

  icons?: unknown[];

  // from the map version
  version: number;
  label?: string;
  item: 'blueprint';

  // incomplete
}

export interface Entity {
  entity_number?: number;

  // presumably always an item; this is *not* colon'd
  name: string;
  inventory?: unknown;
  // e.g. { speed_module: 6 } for factories, not an inventory apparently
  items?: Record<string, number>;
  position?: unknown;
  recipe?: string;
  direction?: number;
  // massively over-specified
  control_behavior?: {
    logistic_condition: {
      first_signal: {
        type: 'item';
        name: string;
      };
      constant: number;
      comparator: '<';
    };
    connect_to_logistic_network: true;
  };
  // e.g. power poles
  neighbours?: number[];

  request_filters?: { name: string; count: number; index?: number }[];
}
