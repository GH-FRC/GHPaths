package frc.ghpaths.show;

import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.PubSubOption;
import edu.wpi.first.networktables.StringSubscriber;
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
 *  - running=false → hold（tShow 冻结,零命令保持）;
 *  - 主控 stop 把时钟归零 → onShowStop() 清锚点,归零样本按全新首样接受（不误报跳变）。
 *
 * 锚点用本地到样时刻（FPGA 时钟）而非 NT 线路时间戳——与主控的 Cristian 时基估计
 * 质量解耦（sim 的 arrivalMs 同语义）;NT timestamp 仅留诊断。
 */
public final class ShowClock {
    private double tShowS;
    private double lastSampleTShowS;
    private double lastSampleLocalTime = -1;
    private boolean running;
    private boolean faulted;
    private String fault = "";

    private final StringSubscriber sub;

    public ShowClock(NetworkTableInstance nt) {
        sub = nt.getStringTopic(Constants.clockTopic())
            .subscribe("{}", PubSubOption.periodic(0.02));
    }

    /** 每 20ms 调一次:读最新样本,更新时钟状态 */
    public void tick() {
        for (var msg : sub.readQueue()) {
            // 本地到样时刻（FPGA 秒）;msg.timestamp 是主控对我方时基的估计值,仅诊断
            handleSample(msg.value, Robot.localTime());
        }
    }

    private void handleSample(String json, double localArrivalS) {
        // 极简 JSON 提取（避免完整 JSON 依赖;样本字段固定）
        double tShowUs = extractNumber(json, "tShowUs");
        boolean run = extractBoolean(json, "running");
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
                // 锚点继续跟随（含归零样本）,arm→resetFault 时按新锚点重启
                lastSampleTShowS = sample;
                lastSampleLocalTime = localArrivalS;
                running = run;
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

    /** 主控 stop 时调（由 ShowCoordinator 检测 STOPPED 状态触发）：
     *  清锚点,使 stop 后主控的时钟归零样本按全新首样接受,不误报跳变（与 sim 的
     *  stop 清 lastTShowUs + showStarted=false 门控等效） */
    public void onShowStop() {
        lastSampleLocalTime = -1;
        tShowS = 0;
        lastSampleTShowS = 0;
    }

    /** arm 转换 = 故障复位路径（stop→arm;与 sim 一致） */
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

    /** 极简布尔提取:"key":true / "key": false（容空格） */
    private static boolean extractBoolean(String json, String key) {
        String pat = "\"" + key + "\":";
        int i = json.indexOf(pat);
        if (i < 0) return false;
        return json.regionMatches(i + pat.length(), "true", 0, 4);
    }
}
