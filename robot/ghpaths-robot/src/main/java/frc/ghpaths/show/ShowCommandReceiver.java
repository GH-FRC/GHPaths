package frc.ghpaths.show;

import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.StringSubscriber;
import edu.wpi.first.wpilibj.DriverStation;
import frc.ghpaths.Constants;
import frc.ghpaths.Robot;

/**
 * 演出命令接收端（show-protocol ShowCommand 的机器人侧实现）。
 *
 * 语义（与 sim/fake-robot 一致,经八关探针验证）：
 *  - arm：装载轨迹（当前为占位;Phase 2 接 PathPlannerLib 路径加载）;
 *  - start(tStart)：开演前置检查——必须已 arm、必须在路径起点附近（>0.15m 拒绝）;
 *  - stop：演出结束,就地待命;hold/resume 冻结/恢复 NT 层;
 *  - 迟到的 start 不得自动装载（防闲置机器人被唤醒入场）。
 */
public final class ShowCommandReceiver {
    public enum ShowState { IDLE, ARMED, RUNNING, HELD, STOPPED }

    private ShowState state = ShowState.IDLE;
    private double tStartShowS;
    private boolean ntFrozen;
    private String fault = "";
    private String lastJson = "";

    private final StringSubscriber sub;

    public ShowCommandReceiver(NetworkTableInstance nt) {
        sub = nt.getStringTopic(Constants.commandTopic()).subscribe("{}", 0.02);
    }

    public void tick() {
        for (var it = sub.readQueue(); it.hasNext();) {
            String json = it.next().value;
            if (json.equals(lastJson)) continue; // 幂等去重
            lastJson = json;
            handle(json);
        }
    }

    private void handle(String json) {
        String kind = extractString(json, "kind");
        if (kind == null) return;
        switch (kind) {
            case "arm" -> {
                // TODO(Phase 2): PathPlannerLib 路径装载（showId/segmentId → 本机轨迹）
                state = ShowState.ARMED;
                fault = "";
            }
            case "start" -> {
                if (state != ShowState.ARMED) {
                    fault = "start 被拒绝:未先 arm";
                    return;
                }
                double tStart = extractNumber(json, "tStartShowUs");
                tStartShowS = Double.isNaN(tStart) ? 0 : tStart / 1e6;
                // 就位检查由 ShowCoordinator 做（需要知道当前位姿与路径起点）
                state = ShowState.RUNNING;
                ntFrozen = false;
                fault = "";
            }
            case "hold", "stop" -> {
                ntFrozen = true;
                if (kind.equals("stop")) {
                    state = ShowState.STOPPED;
                    tStartShowS = 0;
                    fault = "";
                }
            }
            case "resume" -> ntFrozen = false;
            default -> { }
        }
    }

    public ShowState state() { return state; }
    public boolean ntFrozen() { return ntFrozen; }
    public double tStartShowS() { return tStartShowS; }
    public String fault() { return fault; }
    /** 就位检查失败时由 ShowCoordinator 设置 */
    public void setFault(String f) { fault = f; }

    private static String extractString(String json, String key) {
        String pat = "\"" + key + "\":\"";
        int i = json.indexOf(pat);
        if (i < 0) return null;
        int start = i + pat.length();
        int end = json.indexOf('"', start);
        return end > start ? json.substring(start, end) : null;
    }

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
