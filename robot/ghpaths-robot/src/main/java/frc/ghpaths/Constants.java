package frc.ghpaths;

import edu.wpi.first.wpilibj.RobotController;

/** 全局常量——与 packages/show-protocol、field-model 对齐（手工同步,Phase 0 校验）。 */
public final class Constants {
    private Constants() {}

    /** 队号——部署机器填实际队号（sim 用 9001~9006;gradle.properties 里 teamNumber 同步） */
    public static int teamNumber() {
        return TeamNumberProvider.team;
    }

    // ---- NT4 topics（与 show-protocol ntTopics 一致;前导斜杠为 NT4 惯例）----
    public static String poseTopic() {
        return "/ghpaths/" + teamNumber() + "/pose";
    }
    public static String healthTopic() {
        return "/ghpaths/" + teamNumber() + "/health";
    }
    public static String commandTopic() {
        return "/ghpaths/" + teamNumber() + "/cmd";
    }
    public static String clockTopic() {
        return "/ghpaths/clock";
    }

    // ---- 舞台/围栏（field-model DEFAULT_STAGE,外接圆内缩;Phase 0 用实测尺寸替换）----
    public static final double STAGE_WIDTH_M = 12.0;
    public static final double STAGE_DEPTH_M = 8.0;
    public static final double ROBOT_LENGTH_M = 0.9;
    public static final double ROBOT_WIDTH_M = 0.8;
    /** 地理围栏半径 = ½·√(长²+宽²)（外接圆,含旋转;stageGeofence 同式） */
    public static final double GEOFENCE_RADIUS_M =
        Math.sqrt(ROBOT_LENGTH_M * ROBOT_LENGTH_M + ROBOT_WIDTH_M * ROBOT_WIDTH_M) / 2.0;

    // ---- 演出时钟 ----
    /** 断时钟即停的时限（show-protocol SHOW_CLOCK_TIMEOUT_MS） */
    public static final double CLOCK_TIMEOUT_S = 0.75;
    /** 时钟跳变包络余量（到样间隔之外允许的额外前跳） */
    public static final double CLOCK_JUMP_TOLERANCE_S = 0.15;

    // ---- 表演安全硬上限（报告 §六.4;表演不需要比赛性能）----
    public static final double MAX_SPEED_MPS = 1.5;
    public static final double MAX_ACCEL_MPSS = 1.0;
    /** 位姿超出围栏 → 立即停并报 fault */
    public static final double GEOFENCE_MARGIN_M = 0.05;

    /** DS 使能检测周期 */
    public static final double DS_POLL_INTERVAL_S = 0.02;

    /** 诊断:电池电压 */
    public static double batteryVolts() {
        return RobotController.getBatteryVoltage();
    }
}

/** 部署时按机器写入队号（build.gradle 的 teamNumber 同源;Phase 0 可改为读 roboRIO 面板） */
final class TeamNumberProvider {
    static final int team = 9001;
}
