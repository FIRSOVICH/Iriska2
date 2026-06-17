import { Pool } from 'pg';
export declare const pool: Pool;
export declare const query: (text: string, params?: unknown[]) => Promise<import("pg").QueryResult<any>>;
export default pool;
//# sourceMappingURL=pool.d.ts.map