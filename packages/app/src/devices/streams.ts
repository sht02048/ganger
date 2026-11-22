export class DeviceStreams {
  private readonly closers = new Map<string, Set<() => void>>();

  track(deviceId: string, source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let closed = false;
    let closeStream: () => void = () => undefined;
    const release = () => {
      const closers = this.closers.get(deviceId);
      closers?.delete(closeStream);
      if (closers?.size === 0) this.closers.delete(deviceId);
    };
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        closeStream = () => {
          if (closed) return;
          closed = true;
          release();
          controller.close();
          reader.cancel().catch(() => undefined);
        };
        const closers = this.closers.get(deviceId) ?? new Set<() => void>();
        closers.add(closeStream);
        this.closers.set(deviceId, closers);
      },
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (closed) return;
          if (done) closeStream();
          else controller.enqueue(value);
        } catch (error) {
          if (closed) return;
          closed = true;
          release();
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        if (closed) return;
        closed = true;
        release();
        await reader.cancel(reason);
      },
    });
  }

  closeDevice(deviceId: string): void {
    for (const close of this.closers.get(deviceId) ?? []) close();
  }

  openCount(deviceId: string): number {
    return this.closers.get(deviceId)?.size ?? 0;
  }
}
