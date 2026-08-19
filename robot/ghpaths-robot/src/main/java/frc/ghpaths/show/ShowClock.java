package frc.ghpaths.show;

import edu.wpi.first.networktables.DoubleArrayPublisher;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.StringPublisher;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;
import frc.ghpaths.Constants;
import frc.ghpaths.Robot;

/**
 * 演出时钟消费端（show-protocol ShowClockSample 的机器人侧实现）。
 *
 * 语义（与 sim/fake-robot 一致,经八关探针验证）：
 *  - 只以演出时钟驱动轨迹;样本间隔内本地推进（保持控制周期平滑）；
 *  - 断时钟 >750ms → 停（运动许可收回）;
 *  - 时钟跳变防护：样本 tShow 只允许按真实到样间隔推进,不回跳;
 *    越界 → fault 闩锁（就地保持）,仅 stop→arm 复位;
 *  - running=false → hold（tShow 冻结,零命令保持）。
 */
public final class ShowClock {
    private double tShowS;
    private double lastSampleTShowS;
    private double lastSampleLocalTime = -1;
    private boolean running;
    private boolean faulted;
    private String fault = "";

    private final edu.wpi.first.networktables.StringSubscriber sub;

    public ShowClock(NetworkTableInstance nt) {
        sub = nt.getStringTopic(Constants.clockTopic()).subscribe("{}", 0.02);
    }

    /** 每 20ms 调一次:读最新样本,更新时钟状态 */
    public void tick() {
        for (var it = sub.readQueue(); it.hasNext();) {
            var msg = it.next();
            handleSample(msg.value, msg.timestamp / 1e6);
        }
    }

    private void handleSample(String json, double localArrivalS) {
        // 极简 JSON 提取（避免完整 JSON 依赖;样本字段固定三个数字）
        double tShowUs = extractNumber(json, "tShowUs");
        boolean run = json.contains("\"running\":true");
        if (Double.isNaN(tShowUs)) return; // 坏样本忽略

        double sample = tShowUs / 1e6;
        if (lastSampleLocalTime >= 0 && !faulted) {
            double gapS = localArrivalS - lastSampleLocalTime;
            double deltaS = sample - tShowS;
            double allowS = gapS + Constants.CLOCK_JUMP_TOLERANCE_S;
            if (deltaS < -0.05 || deltaS > allowS) {
                faulted = true;
                fault = String.format("时钟跳变 %.2fs（拒绝跟踪,就地保持）", deltaS);
                System.out.println("[ghpaths] " + fault);
                return;
            }
        }
        lastSampleTShowS = sample;
        lastSampleLocalTime = localArrivalS;
        running = run;
        if (!faulted) tShowS = sample;
    }

    /** 当前演出时钟（秒;样本间本地推进） */
    public double tShowS() {
        if (running && lastSampleLocalTime >= 0 && !faulted) {
            double localNow = Robot.localTime();
            double elapsed = Math.max(0, localNow - lastSampleLocalTime);
            return lastSampleTShowS + elapsed;
        }
        return tShowS;
    }

    public boolean isRunning() { return running && !faulted; }
    public boolean isFaulted() { return faulted; }
    public String fault() { return fault; }
    /** 时钟新鲜（<750ms 内有样本） */
    public boolean isFresh() {
        return lastSampleLocalTime >= 0
            && Robot.localTime() - lastSampleLocalTime < Constants.CLOCK_TIMEOUT_S;
    }

    /** stop→arm 路径复位（与 ShowCoordinator 联动） */
    public void resetFault() {
        faulted = false;
        fault = "";
        tShowS = lastSampleTShowS;
    }

    /** 极简数字提取:在 json 中找 "key":number 并返回;找不到返回 NaN */
    private static double extractNumber(String json, String key) {
        String pat = "\"" + key + "\":";
        int i = json.indexOf(pat);
        if (i < 0) return Double.NaN;
        int start = i + pat.length();
        int end = start;
        while (end < json.length()
            && (Character.isDigit(json.charAt(end)) || "+-.eE".indexOf(json.charAt(end)) >= 0)) {
            end++;
        }
        try {
            return Double.parseDouble(json.substring(start, end));
        } catch (NumberFormatException e) {
            return Double.NaN;
        }
    }
}
