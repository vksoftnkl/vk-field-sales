import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_customers.sql';
import m0002 from './0002_companies_new_customer.sql';
import m0003 from './0003_customers_like_vk_nex.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003
    }
  }
  