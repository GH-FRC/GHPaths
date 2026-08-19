package frc.ghpaths.show;

import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.PubSubOption;
import edu.wpi.first.networktables.StringSubscriber;
import frc.ghpaths.Constants;

/**
 * 演出命令接收端（show-protocol ShowCommand 的机器人侧实现）。
 *
 * 语义（与 sim/fake-robot 一致,经八关探针验证）：
 *  - arm：装载轨迹（当前为占位;Phase 2 接 PathPlannerLib 路径加载）;
 *  - start(tStart)：须已 arm 且未 stop（迟到的 start 不得自动装载——防闲置机器人被唤醒入场）;
 *    hold 后重复 start 视同 resume（frozen 解除,与 sim 一致）;
 *  - stop：演出结束,就地待命;hold/resume 冻结/恢复 NT 层;
 *  - 未 arm 的 start / STOPPED 下的 start 一律拒绝。
 */
public final class ShowCommandReceiver {
    public enum ShowState { IDLE, ARMED, RUNNING, HELD, STOPPED }

    /** arm 命令携带的本机路径（极简映射;Phase 2 接 PathPlannerLib 后换正式类型） */
    public static final class PathWaypoint {
        public final double xM, yM, headingRad;
        public final long tShowUs;
        PathWaypoint(double xM, double yM, double headingRad, long tShowUs) {
            this.xM = xM; this.yM = yM; this.headingRad = headingRad; this.tShowUs = tShowUs;
        }
    }
    public static final class RobotPath {
        public final int robot;
        public final java.util.List<PathWaypoint> waypoints;
        RobotPath(int robot, java.util.List<PathWaypoint> waypoints) {
            this.robot = robot; this.waypoints = waypoints;
        }
    }

    /** arm 命令装载的路径（null = 未装载/用内置;ShowCoordinator 消费） */
    private RobotPath armedPath;

    private ShowState state = ShowState.IDLE;
    /** 已 arm 且未 stop（start 的可接受域;比 state==ARMED 宽——覆盖 hold 后重复 start） */
    private boolean armed;
    private double tStartShowS;
    private boolean ntFrozen;
    private String fault = "";
    private String lastJson = "";

    private final StringSubscriber sub;

    public ShowCommandReceiver(NetworkTableInstance nt) {
        sub = nt.getStringTopic(Constants.commandTopic())
            .subscribe("{}", PubSubOption.periodic(0.02));
    }

    public void tick() {
        for (var msg : sub.readQueue()) {
            String json = msg.value;
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
                // arm.path 携带编辑器路径（JSON;极简解析,Phase 2 换 PathPlannerLib 正式装载）
                armedPath = parsePath(json);
                state = ShowState.ARMED;
                armed = true;
                fault = "";
            }
            case "start" -> {
                if (!armed) {
                    fault = "start 被拒绝:未先 arm";
                    return;
                }
                double tStart = extractNumber(json, "tStartShowUs");
                tStartShowS = Double.isNaN(tStart) ? 0 : tStart / 1e6;
                // 就位检查由 ShowCoordinator 在此回调后做（需要位姿与路径起点）
                state = ShowState.RUNNING;
                ntFrozen = false;
                fault = "";
            }
            case "hold", "stop" -> {
                ntFrozen = true;
                if (kind.equals("stop")) {
                    state = ShowState.STOPPED;
                    armed = false;
                    tStartShowS = 0;
                    fault = "";
                }
            }
            case "resume" -> ntFrozen = false;
            default -> { }
        }
    }

    public ShowState state() { return state; }
    public RobotPath armedPath() { return armedPath; }
    public boolean ntFrozen() { return ntFrozen; }
    public double tStartShowS() { return tStartShowS; }
    public String fault() { return fault; }
    /** 就位检查失败时由 ShowCoordinator 设置 */
    public void setFault(String f) { fault = f; }

    /** 极简路径解析："waypoints":[{"xM":..,"yM":..,"headingRad":..,"tShowUs":..},..] */
    private static RobotPath parsePath(String json) {
        int team = Constants.teamNumber();
        String wpKey = "\"waypoints\":[";
        int wi = json.indexOf(wpKey);
        if (wi < 0) return null;
        java.util.List<PathWaypoint> wps = new java.util.ArrayList<>();
        int pos = wi + wpKey.length();
        while (pos < json.length()) {
            int objStart = json.indexOf('{', pos);
            if (objStart < 0) break;
            int objEnd = json.indexOf('}', objStart);
            if (objEnd < 0) break;
            String obj = json.substring(objStart, objEnd + 1);
            double x = extractNumber(obj, "xM");
            double y = extractNumber(obj, "yM");
            double h = extractNumber(obj, "headingRad");
            double t = extractNumber(obj, "tShowUs");
            if (Double.isNaN(x) || Double.isNaN(y) || Double.isNaN(h) || Double.isNaN(t)) {
                return null; // 坏数据整体拒绝
            }
            wps.add(new PathWaypoint(x, y, h, (long) t));
            pos = objEnd + 1;
        }
        if (wps.size() < 2) return null;
        return new RobotPath(team, wps);
    }

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
