import { createCodeDump } from './zipProcessor';
import { WorkerRequest, WorkerResponse } from '../types';

const controllers = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;

    if (message.type === 'cancel') {
        controllers.get(message.id)?.abort();
        controllers.delete(message.id);
        return;
    }

    const controller = new AbortController();
    controllers.set(message.id, controller);

    try {
        const result = await createCodeDump(
            message.fileBuffer,
            message.options,
            (percent, status) => {
                const response: WorkerResponse = { type: 'progress', id: message.id, percent, message: status };
                self.postMessage(response);
            },
            controller.signal,
            message.fileName
        );

        const response: WorkerResponse = { type: 'done', id: message.id, result };
        self.postMessage(response);
    } catch (error) {
        const response: WorkerResponse = {
            type: 'error',
            id: message.id,
            message: error instanceof Error ? error.message : 'Unknown worker error',
        };
        self.postMessage(response);
    } finally {
        controllers.delete(message.id);
    }
};

export {};
