/**
 * Performance Monitoring Utility
 * Tracks component render times and frame budget compliance
 * Target: <16ms per render for 60fps
 */

import React from 'react';

export interface RenderMetrics {
  componentName: string;
  phase: 'mount' | 'update';
  actualDuration: number; // Time spent rendering
  baseDuration: number; // Estimated time without memoization
  startTime: number;
  commitTime: number;
  interactions: Set<any>;
}

export interface PerformanceReport {
  component: string;
  avgRenderTime: number;
  maxRenderTime: number;
  minRenderTime: number;
  renderCount: number;
  slowRenders: number; // Renders >16ms
  frameDrops: number; // Renders >32ms (2 frames)
}

class PerformanceMonitor {
  private enabled = __DEV__;
  // @copilot-review-fix (Round 10): Configurable logging - defaults to __DEV__ to maintain
  // debugging capability. Override with LOG_SLOW_RENDERS env var if needed.
  private logSlowRenders = process.env.LOG_SLOW_RENDERS != null 
    ? process.env.LOG_SLOW_RENDERS === 'true' 
    : __DEV__;
  private metrics: Map<string, RenderMetrics[]> = new Map();
  private readonly FRAME_BUDGET = 16; // ms for 60fps
  private readonly FRAME_DROP_THRESHOLD = 32; // 2 frames

  /**
   * Log render metrics from React.Profiler
   */
  logRender(
    id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
    interactions: Set<any>
  ): void {
    if (!this.enabled) return;

    const metrics: RenderMetrics = {
      componentName: id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
      interactions,
    };

    // Store metrics
    const componentMetrics = this.metrics.get(id) || [];
    componentMetrics.push(metrics);
    this.metrics.set(id, componentMetrics);

    // Log slow renders (controlled by LOG_SLOW_RENDERS env var or setLogSlowRenders())
    // @copilot-review-fix: Made configurable instead of commented out
    if (this.logSlowRenders && actualDuration > this.FRAME_BUDGET) {
      const severity = actualDuration > this.FRAME_DROP_THRESHOLD ? '🔴' : '🟡';
      console.warn(
        `${severity} Slow render detected: ${id} (${phase})`,
        `\n  Duration: ${actualDuration.toFixed(2)}ms`,
        `\n  Base: ${baseDuration.toFixed(2)}ms`,
        `\n  Budget: ${this.FRAME_BUDGET}ms`,
        `\n  Over budget by: ${(actualDuration - this.FRAME_BUDGET).toFixed(2)}ms`
      );
    }
  }

  /**
   * Generate performance report for a component
   */
  getReport(componentName: string): PerformanceReport | null {
    const metrics = this.metrics.get(componentName);
    if (!metrics || metrics.length === 0) return null;

    const durations = metrics.map((m) => m.actualDuration);
    const slowRenders = durations.filter((d) => d > this.FRAME_BUDGET).length;
    const frameDrops = durations.filter((d) => d > this.FRAME_DROP_THRESHOLD).length;

    return {
      component: componentName,
      avgRenderTime: durations.reduce((a, b) => a + b, 0) / durations.length,
      maxRenderTime: Math.max(...durations),
      minRenderTime: Math.min(...durations),
      renderCount: metrics.length,
      slowRenders,
      frameDrops,
    };
  }

  /**
   * Get all performance reports
   */
  getAllReports(): PerformanceReport[] {
    const reports: PerformanceReport[] = [];
    this.metrics.forEach((_, componentName) => {
      const report = this.getReport(componentName);
      if (report) reports.push(report);
    });
    return reports.sort((a, b) => b.avgRenderTime - a.avgRenderTime);
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    if (!this.enabled) return;

    const reports = this.getAllReports();
    if (reports.length === 0) {
      console.log('📊 No performance data collected');
      return;
    }

    console.log('\n📊 Performance Summary');
    console.log('━'.repeat(70));
    console.log(
      `${'Component'.padEnd(30)} ${'Avg (ms)'.padStart(10)} ${'Max (ms)'.padStart(10)} ${'Slow'.padStart(8)} ${'Drops'.padStart(8)}`
    );
    console.log('━'.repeat(70));

    reports.forEach((r) => {
      const avgIcon = r.avgRenderTime > this.FRAME_BUDGET ? '🟡' : '🟢';
      const maxIcon = r.maxRenderTime > this.FRAME_DROP_THRESHOLD ? '🔴' : r.maxRenderTime > this.FRAME_BUDGET ? '🟡' : '🟢';
      
      console.log(
        `${r.component.padEnd(30)} ${avgIcon} ${r.avgRenderTime.toFixed(2).padStart(8)} ${maxIcon} ${r.maxRenderTime.toFixed(2).padStart(8)} ${r.slowRenders.toString().padStart(8)} ${r.frameDrops.toString().padStart(8)}`
      );
    });

    console.log('━'.repeat(70));
    console.log(`Legend: 🟢 Good (<${this.FRAME_BUDGET}ms) | 🟡 Slow (>${this.FRAME_BUDGET}ms) | 🔴 Frame Drop (>${this.FRAME_DROP_THRESHOLD}ms)`);
    console.log('\n');
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Enable/disable slow render logging
   * @copilot-review-fix: Added method to enable/disable logging without code changes
   */
  setLogSlowRenders(enabled: boolean): void {
    this.logSlowRenders = enabled;
  }
}

export const performanceMonitor = new PerformanceMonitor();

/**
 * Hook to track component render count
 */
export const useRenderCount = (componentName: string): void => {
  const renderCount = React.useRef(0);
  
  React.useEffect(() => {
    if (!__DEV__) return;
    renderCount.current += 1;
    console.log(`🔄 ${componentName} render #${renderCount.current}`);
  });
};

// Export for development console access
if (__DEV__) {
  (globalThis as any).performanceMonitor = performanceMonitor;
}
