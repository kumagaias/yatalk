import {
  Firestore,
  type DocumentData,
  type Transaction,
  type WhereFilterOp,
} from "@google-cloud/firestore";

export type FirestoreDocument = Record<string, unknown>;

export interface StoreFilter {
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

export interface StoreOrder {
  field: string;
  direction?: "asc" | "desc";
}

export interface StoreTransaction {
  get<T extends FirestoreDocument>(collection: string, id: string): Promise<T | undefined>;
  query<T extends FirestoreDocument>(collection: string, filters?: StoreFilter[], order?: StoreOrder, limit?: number): Promise<Array<T & { id: string }>>;
  create(collection: string, id: string, value: FirestoreDocument): void;
  set(collection: string, id: string, value: FirestoreDocument): void;
  update(collection: string, id: string, value: FirestoreDocument): void;
  delete(collection: string, id: string): void;
}

export class FirestoreStore {
  readonly kind = "firestore";

  constructor(readonly client: Firestore) {}

  async get<T extends FirestoreDocument>(collection: string, id: string): Promise<T | undefined> {
    const snapshot = await this.client.collection(collection).doc(id).get();
    return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as unknown as T) : undefined;
  }

  async query<T extends FirestoreDocument>(
    collection: string,
    filters: StoreFilter[] = [],
    order?: StoreOrder,
    limit?: number,
  ): Promise<Array<T & { id: string }>> {
    let query: FirebaseFirestore.Query<DocumentData> = this.client.collection(collection);
    for (const filter of filters) query = query.where(filter.field, filter.op, filter.value);
    if (order) query = query.orderBy(order.field, order.direction ?? "asc");
    if (limit !== undefined) query = query.limit(limit);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T & { id: string });
  }

  create(collection: string, id: string, value: FirestoreDocument): Promise<void> {
    return this.client.collection(collection).doc(id).create(value).then(() => undefined);
  }

  set(collection: string, id: string, value: FirestoreDocument): Promise<void> {
    return this.client.collection(collection).doc(id).set(value).then(() => undefined);
  }

  update(collection: string, id: string, value: FirestoreDocument): Promise<void> {
    return this.client.collection(collection).doc(id).update(value).then(() => undefined);
  }

  delete(collection: string, id: string): Promise<void> {
    return this.client.collection(collection).doc(id).delete().then(() => undefined);
  }

  runTransaction<T>(work: (transaction: StoreTransaction) => Promise<T>): Promise<T> {
    return this.client.runTransaction((transaction) => work(new FirestoreTransaction(this.client, transaction)));
  }
}

class FirestoreTransaction implements StoreTransaction {
  constructor(private readonly client: Firestore, private readonly transaction: Transaction) {}

  async get<T extends FirestoreDocument>(collection: string, id: string): Promise<T | undefined> {
    const snapshot = await this.transaction.get(this.client.collection(collection).doc(id));
    return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as unknown as T) : undefined;
  }

  async query<T extends FirestoreDocument>(
    collection: string,
    filters: StoreFilter[] = [],
    order?: StoreOrder,
    limit?: number,
  ): Promise<Array<T & { id: string }>> {
    let query: FirebaseFirestore.Query<DocumentData> = this.client.collection(collection);
    for (const filter of filters) query = query.where(filter.field, filter.op, filter.value);
    if (order) query = query.orderBy(order.field, order.direction ?? "asc");
    if (limit !== undefined) query = query.limit(limit);
    const snapshot = await this.transaction.get(query);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T & { id: string });
  }

  create(collection: string, id: string, value: FirestoreDocument): void {
    this.transaction.create(this.client.collection(collection).doc(id), value);
  }

  set(collection: string, id: string, value: FirestoreDocument): void {
    this.transaction.set(this.client.collection(collection).doc(id), value);
  }

  update(collection: string, id: string, value: FirestoreDocument): void {
    this.transaction.update(this.client.collection(collection).doc(id), value);
  }

  delete(collection: string, id: string): void {
    this.transaction.delete(this.client.collection(collection).doc(id));
  }
}

export function createFirestoreStore(projectId: string): FirestoreStore {
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is required for Firestore storage");
  return new FirestoreStore(new Firestore({ projectId }));
}

export function isFirestoreStore(value: unknown): value is FirestoreStore {
  return value instanceof FirestoreStore;
}
