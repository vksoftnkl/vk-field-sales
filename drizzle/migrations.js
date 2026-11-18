// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_customers.sql';
import m0002 from './0002_companies_new_customer.sql';
import m0003 from './0003_customers_like_vk_nex.sql';
import m0004 from './0004_sync_customers.sql';
import m0005 from './0005_remove_test_customers.sql';
import m0006 from './0006_ledger_and_customer_edits.sql';
import m0007 from './0007_orders_items_visits.sql';
import m0008 from './0008_orders_visits_upload.sql';
import m0009 from './0009_remove_test_companies.sql';
import m0010 from './0010_sale_bills.sql';
import m0011 from './0011_receipts.sql';
import m0012 from './0012_tender_surcharge.sql';
import m0013 from './0013_sale_returns.sql';
import m0014 from './0014_remove_test_salesmen.sql';
import m0015 from './0015_sale_order_workflow.sql';
import m0016 from './0016_branches.sql';
import m0017 from './0017_branch_default.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009,
m0010,
m0011,
m0012,
m0013,
m0014,
m0015,
m0016,
m0017
    }
  }
  