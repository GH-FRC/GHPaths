package frc.ghpaths.show;

import edu.wpi.first.networktables.DoubleArrayPublisher;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.StringPublisher;
import frc.ghpaths.Constants;
import frc.ghpaths.Robot;

/**
 * 遥测发布器——show-protocol 的 NT4 topics 机器人侧实现。
 *
 *  - pose：double[] [tShowUs, x, y, heading]（20ms;格式与 sim/nt-link 对齐）
 *  - health：JSON 字符串（变化时+至少 1Hz;字段与 RobotHealth 一致）
 *
 * 注:health 用 StringTopic 而非 NT4 "json" 类型串——演控端（nt-link）按
 * topic 名匹配与内容解析,类型串差异不影响互通（announce 类型码同为 4）。
 */
public final class TelemetryPublisher {
    private final DoubleArrayPublisher posePub;
    private final StringPublisher healthPub;
    private String lastHealth = "";
    private double lastHealthTime = -1;

    public TelemetryPublisher() {
        NetworkTableInstance nt = NetworkTableInstance.getDefault();
        posePub = nt.getDoubleArrayTopic(Constants.poseTopic()).publish();
        healthPub = nt.getStringTopic(Constants.healthTopic()).publish();
    }

    public void tick() {
        // 空实现占位（保持与 Robot.robotPeriodic 的两段式调用对称）;实际发布在 publish()
    }

    /** 每 20ms 由 ShowCoordinator 调用 */
    public void publish(double xM, double yM, double headingRad, double tShowS,
                        boolean dsLinked, boolean enabled, String showState,
                        boolean clockLinked, String fault) {
        posePub.set(new double[] {
            Math.round(tShowS * 1e6),
            xM, yM, headingRad,
        });

        String health = String.format(
            "{\"dsLinked\":%b,\"enabled\":%b,\"estopped\":false,"
            + "\"clockLinked\":%b,\"showState\":\"%s\","
            + "\"codeVersion\":\"robot-0.1\",\"fault\":%s}",
            dsLinked, enabled, clockLinked, showState,
            fault == null || fault.isEmpty() ? "null" : "\"" + fault + "\"");

        double now = Robot.localTime();
        if (!health.equals(lastHealth) || now - lastHealthTime > 1.0) {
            healthPub.set(health);
            lastHealth = health;
            lastHealthTime = now;
        }
    }
}
